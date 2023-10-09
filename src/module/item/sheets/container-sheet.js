import DLBaseItemSheet from './base-item-sheet'
import {
  postItemToChat,
} from '../../chat/roll-messages'
import {
  getNestedDocument,
  getNestedItemData
} from '../nested-objects'

export default class DLContainerSheet extends DLBaseItemSheet {
  /* -------------------------------------------- */
  /*  Data                                        */
  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    return super.defaultOptions
  }

  /** @override */
  get template() {
    return 'systems/demonlord/templates/item/item-container-sheet.hbs'
  }

  /** @override */
  async getData(options) {
    const data = await super.getData(options)
    const containerData = data.system
    containerData.contents = await Promise.all(containerData.contents.map(await getNestedItemData))
    return data
  }

  /* -------------------------------------------- */
  /*  Listeners                                   */

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html)

    const inputs = html.find('input')
    inputs.focus(ev => ev.currentTarget.select())

    // New Toggle Info
    html.find('.dlToggleInfoBtn').click(ev => {
      const root = $(ev.currentTarget).closest('[data-item-id]')
      const elem = $(ev.currentTarget)
      const selector = '.fa-chevron-down, .fa-chevron-up'
      const chevron = elem.is(selector) ? elem : elem.find(selector);
      const elements = $(root).find('.dlInfo')
      elements.each((_, el) => {
        if (el.style.display === 'none') {
          $(el).slideDown(100)
          chevron?.removeClass('fa-chevron-up')
          chevron?.addClass('fa-chevron-down')
        } else {
          $(el).slideUp(100)
          chevron?.removeClass('fa-chevron-down')
          chevron?.addClass('fa-chevron-up')
        }
      })
    })

    // Item uses
    html.on('mousedown', '.item-uses', async ev => await this._onUpdateItemQuantity(ev))

    this.form.ondrop = ev => this._onDrop(ev);

    html.find('.item-delete').click(async ev => await this._onItemDelete(ev))
    html.find('.edit-nested-item').click(async (ev) => await this._onNestedItemEdit(ev))

    html.find('.item-roll').click(async ev => {
      ev.preventDefault()
      ev.button = 2;
      await this._onUpdateItemQuantity(ev);
      
      const id = ev.currentTarget.closest("[data-item-id]").dataset.itemId;
      await this.useItem(id);
      const itemIndex = $(ev.currentTarget).closest('[data-item-index]').data('itemIndex')
      await this.deleteItem(itemIndex);
    })

    if (this.object.parent?.isOwner) {
      const handler = ev => this._onDragStart(ev)
      html.find('.dropitem').each((i, li) => {
        li.setAttribute('draggable', true)
        li.addEventListener('dragstart', handler, false)
      })
    }
  }

  /* -------------------------------------------- */
  /*  Auxiliary functions                         */
  /* -------------------------------------------- */

  _onDragStart(ev) {
    console.log(ev)
  }

  async _onDrop(ev) {
    try {
      const data = JSON.parse(ev.dataTransfer.getData('text/plain'))
      if (data.type === 'Item') {
        await this._addItem(data)
        if (data.uuid.startsWith('Actor.')) {
          const actor = await fromUuid(data.uuid.split('.').slice(0,2).join('.'))
          const item = duplicate(actor.items.get(data.uuid.split('.').toReversed()[0]))
          item.system.quantity--
          await Item.updateDocuments([item], { parent: actor })
        }
      }
    } catch (e) {
      console.warn(e)
    }
  }

  async _addItem(data) {
    const item = await getNestedItemData(data)
    if (!item || !['ammo', 'armor', 'item', 'spell', 'weapon'].includes(item.type)){
      console.warn('Wrong item type dragged', this.item, data)
      return
    }

    const containerData = duplicate(this.item)
    const existingItem = containerData.system.contents.find(content => content._id == item._id)
    if (existingItem != null) {
      await this.increaseItemQuantity(containerData.system.contents.indexOf(existingItem))
    } else {
      containerData.system.contents.push(item);
    }
    await this.item.update(containerData, {diff: false}).then(_ => this.render)
  }

  async _onNestedItemCreate(ev) {
    const item = await super._onNestedItemCreate(ev)
    await this._addItem(item.data)
    return item
  }

  async _onItemDelete(ev) {
    const itemIndex = $(ev.currentTarget).closest('[data-item-index]').data('itemIndex')
    await this.deleteItem(itemIndex)
  }

    /** @override */
    async _onNestedItemEdit(ev) {
      const itemId = $(ev.currentTarget).closest('[data-item-id]').data('itemId')
      const data = await this.getData({})
      const nestedData = data.system.contents.find(i => i._id === itemId)
      await getNestedDocument(nestedData).then(d => {
        if (d.sheet) d.sheet.render(true)
        else ui.notifications.warn('The item is not present in the game and cannot be edited.')
      })
    }



  /* -------------------------------------------- */
  /*  Rolls and Actions                           */

  /* -------------------------------------------- */

  async useItem(itemID) {
    const item = duplicate(this.object.system.contents.find(content => content._id == itemID))
    const owner = this.object.parent;
    if (!owner instanceof Actor) return
    if (['ammo', 'armor', 'item', 'weapon'].includes(item.type)) {
        await owner._sheet._onDropItemCreate(item)
    } else if (item.type == 'spell') {
      await this.useSpell(item)
    }
  }

  async useSpell(spell) {
    const owner = this.object.parent;
    if (spell.system.rank >= owner.system.characteristics.power){
      const castingBanes = parseInt(owner.system.characteristics.power)-parseInt(spell.system.rank);
      const roll = owner.rollAttribute(owner.system.attributes.intellect, castingBanes, 0)
      if (roll == 'FAILURE')
        return
    }
      spell.name = `${spell.name} (Incantation)`
      spell.system.castings = {
        ignoreCalculations: true,
        max: '1',
        value: "0"
      }
      const spellID = await owner._sheet._onDropItemCreate(spell);
      await owner.rollSpell(spellID[0]._id);
      await Item.deleteDocuments([spellID[0]._id], {parent: owner})
  }

  async increaseItemQuantity(itemIndex) {
    const itemData = duplicate(this.item)
    itemData.system.contents[itemIndex].system.quantity++
    await this.item.update(itemData)
  }

  async decreaseItemQuantity(itemIndex) {
    const itemData = duplicate(this.item)
    if (itemData.system.contents[itemIndex].system.quantity > 0) {
      itemData.system.contents[itemIndex].system.quantity--
      await this.item.update(itemData)
    } else {
      await this.deleteItem(itemIndex)
    }
  }

  async deleteItem(itemIndex) {
    const itemData = duplicate(this.item)

    itemData.system.contents.splice(itemIndex, 1)
    await this.item.update(itemData)
  }
}