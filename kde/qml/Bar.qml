// The clipboard bar (Meta+V): header with filters and search, cards, menus and editors.
// The window is a layer-shell surface over the work area; the panel sits at its bottom (or top).
import QtQuick
import QtQuick.Window
import QtQuick.Controls.Basic as B
import QtQuick.Layouts

Window {
    id: win
    title: "copy-addict"
    visible: false
    color: "transparent"
    flags: Qt.FramelessWindowHint

    property int focusIndex: 0              // -1 = search box
    property string focusedId: ""
    property double now: Date.now()
    property string flashText: ""
    property bool wasActive: false
    property real wheelAccum: 0
    readonly property bool popupOpen: itemMenu.opened || filterMenu.opened || editor.opened || clearConfirm.opened
    readonly property int count: history.count

    // ---------- lifecycle ----------
    onActiveChanged: {
        if (active)
            wasActive = true
        else if (wasActive && app.isOpen && !app.preview)
            app.close()     // clicked another window or a panel
    }
    onVisibleChanged: {
        if (!visible) {
            wasActive = false
            closePopups()
        } else {
            Qt.callLater(() => { list.positionViewAtBeginning(); search.forceActiveFocus() })
        }
    }

    Connections {
        target: app
        function onAboutToOpen() { win.reset() }
        function onClearConfirmRequested() { Qt.callLater(clearConfirm.ask) }
    }
    Connections {
        target: history
        function onRowsInserted() { win.syncFocus() }
        function onRowsRemoved() { win.syncFocus() }
        function onRowsMoved() { win.syncFocus() }
        function onModelReset() { win.syncFocus() }
        function onLayoutChanged() { win.syncFocus() }
    }
    Timer { interval: 30000; running: win.visible; repeat: true; onTriggered: win.now = Date.now() }
    Timer { id: flashTimer; interval: 2200; onTriggered: win.flashText = "" }

    // Copyous default: search and filters start fresh every time.
    function reset() {
        closePopups()
        flashText = ""
        search.text = ""
        history.reset()
        now = Date.now()
        setFocus(0)
        list.positionViewAtBeginning()
        search.forceActiveFocus()
    }

    function closePopups() {
        itemMenu.close()
        filterMenu.close()
        editor.close()
        clearConfirm.close()
    }

    // ---------- focus ----------
    function setFocus(i) {
        if (count === 0) {
            focusIndex = -1
        } else {
            focusIndex = Math.max(-1, Math.min(count - 1, i))
        }
        focusedId = focusIndex >= 0 ? history.idAt(focusIndex) : ""
        list.currentIndex = focusIndex
    }

    // Keep the same item focused when the list changes under it.
    function syncFocus() {
        if (focusedId !== "") {
            const i = history.rowOf(focusedId)
            if (i >= 0) { setFocus(i); return }
        }
        if (focusIndex >= count) setFocus(count - 1)
        else if (focusIndex === -1) setFocus(-1)
        else setFocus(focusIndex)
    }

    function filtersChanged() {
        setFocus(0)
    }

    function flash(text) {
        flashText = text
        flashTimer.restart()
    }

    function cycleType(step) {
        const list = [""].concat(app.typeOrder)
        const i = list.indexOf(history.typeFilter)
        history.typeFilter = list[(i + step + list.length) % list.length]
        filtersChanged()
    }

    function cycleTag(step) {
        const list = [""].concat(app.tags.map(t => t.id))
        const i = list.indexOf(history.tagFilter)
        history.tagFilter = list[(i + step + list.length) % list.length]
        filtersChanged()
    }

    function pageSize() {
        return Math.max(1, Math.floor(list.width / (settings.itemWidth + 10)))
    }

    function cardAt(row) {
        return list.itemAtIndex(row)
    }

    function deleteItem(id, force) {
        if (!app.deleteItem(id, force))
            flash(i18n("Protected item: use Shift+Delete to delete it"))
    }

    function editTitle(row) {
        setFocus(row)
        list.positionViewAtIndex(row, ListView.Contain)
        const c = cardAt(row)
        if (c) c.editTitle()
    }

    function openEditor(id, type) {
        if (!app.isEditable(type)) return
        editor.edit(id, app.content(id), type === "code")
    }

    // ---------- keyboard ----------
    function handleKey(event) {
        const ctrl = (event.modifiers & Qt.ControlModifier) !== 0
        const shift = (event.modifiers & Qt.ShiftModifier) !== 0
        const code = event.nativeScanCode        // digits by key position: 10..19 = 1..9, 0
        const digit = code >= 10 && code <= 19
        const k = event.key
        const onItem = focusIndex >= 0
        const id = onItem ? history.idAt(focusIndex) : ""
        const card = onItem ? cardAt(focusIndex) : null
        const text = search.text
        let handled = true

        if (k === Qt.Key_Escape) {
            if (text) search.text = ""
            else app.close()
        } else if (ctrl && shift && digit) {
            const i = code - 10
            const tag = i < 9 ? app.tags[i].id : ""
            history.tagFilter = history.tagFilter === tag ? "" : tag
            filtersChanged()
        } else if (ctrl && !shift && digit) {
            setFocus(code - 10)
        } else if (k === Qt.Key_Alt || k === Qt.Key_AltGr) {
            history.pinnedOnly = !history.pinnedOnly
            filtersChanged()
        } else if (ctrl && (k === Qt.Key_Tab || k === Qt.Key_Backtab)) {
            cycleType(shift || k === Qt.Key_Backtab ? -1 : 1)
        } else if (ctrl && (k === Qt.Key_QuoteLeft || k === Qt.Key_AsciiTilde || k === Qt.Key_Dead_Grave || k === Qt.Key_Dead_Tilde)) {
            cycleTag(shift || k === Qt.Key_AsciiTilde || k === Qt.Key_Dead_Tilde ? -1 : 1)
        } else if (ctrl && k === Qt.Key_F) {
            setFocus(-1)
            search.selectAll()
        } else if (k === Qt.Key_Tab || k === Qt.Key_Backtab) {
            setFocus(onItem ? -1 : 0)
        } else if (k === Qt.Key_Return || k === Qt.Key_Enter) {
            const target = onItem ? id : history.idAt(0)
            if (target) app.choose(target, shift, ctrl)
        } else if (k === Qt.Key_Space && onItem && !text) {
            app.choose(id, shift, ctrl)
        } else if (k === Qt.Key_Backspace && !text && (history.typeFilter || history.tagFilter)) {
            history.typeFilter = ""
            history.tagFilter = ""
            filtersChanged()
        } else if (onItem && k === Qt.Key_Right) {
            setFocus(focusIndex + 1)
        } else if (onItem && k === Qt.Key_Left) {
            setFocus(Math.max(0, focusIndex - 1))
        } else if (onItem && k === Qt.Key_Up) {
            setFocus(-1)
        } else if (onItem && k === Qt.Key_Down) {
            // already on the items
        } else if (onItem && k === Qt.Key_Home) {
            setFocus(0)
        } else if (onItem && k === Qt.Key_End) {
            setFocus(count - 1)
        } else if (onItem && k === Qt.Key_PageDown) {
            setFocus(focusIndex + pageSize())
        } else if (onItem && k === Qt.Key_PageUp) {
            setFocus(Math.max(0, focusIndex - pageSize()))
        } else if (onItem && k === Qt.Key_Delete) {
            deleteItem(id, shift)
        } else if (onItem && ctrl && k === Qt.Key_S) {
            app.togglePin(id)
        } else if (onItem && ctrl && k === Qt.Key_E) {
            openEditor(id, card ? card.type : "")
        } else if (onItem && ctrl && k === Qt.Key_T) {
            editTitle(focusIndex)
        } else if (onItem && ctrl && k === Qt.Key_A) {
            if (card) openItemMenu(focusIndex, card, -1, -1)
        } else if (onItem && ctrl && k === Qt.Key_C) {
            app.activate(id, "copy")
        } else if (!onItem && k === Qt.Key_Down && count > 0) {
            setFocus(0)
        } else {
            handled = false     // typing, Backspace, caret keys: the search box
        }
        event.accepted = handled
    }

    // ---------- menus ----------
    function openItemMenu(row, card, px, py) {
        setFocus(row)
        const id = card.itemId
        const type = card.type
        const e = []
        e.push({ text: i18n("Paste"), icon: "edit-paste-symbolic", accel: "Enter", run: () => app.activate(id, "paste") })
        e.push({ text: i18n("Copy without pasting"), icon: "edit-copy-symbolic", accel: "Shift+Enter", run: () => app.activate(id, "copy") })
        if (app.isEditable(type))
            e.push({ text: i18n("Edit"), icon: "document-edit-symbolic", accel: "Ctrl+E", run: () => openEditor(id, type) })
        e.push({ text: i18n("Edit title"), icon: "insert-text-symbolic", accel: "Ctrl+T", run: () => editTitle(history.rowOf(id)) })
        if (type === "link")
            e.push({ text: i18n("Open in browser"), icon: "web-browser-symbolic", accel: "Ctrl+Enter", run: () => app.openItem(id) })
        if (type === "file" || type === "image") {
            e.push({ text: i18n("Open"), icon: "document-open-symbolic", accel: type === "file" ? "Ctrl+Enter" : "", run: () => app.openItem(id) })
            e.push({ text: i18n("Show in folder"), icon: "folder-open-symbolic", run: () => app.showInFolder(id) })
        }
        if (type === "file" || type === "files" || type === "image")
            e.push({ text: i18n("Paste as path"), icon: "insert-link-symbolic", run: () => app.pastePaths(id) })
        if (type === "color") {
            for (const c of app.colorConversions(id)) {
                const value = c.value
                e.push({ text: c.label, icon: "applications-graphics-symbolic", run: () => app.pasteText(id, value) })
            }
        }
        e.push({ text: card.pinned ? i18n("Unpin") : i18n("Pin"), icon: "view-pin-symbolic", accel: "Ctrl+S", separatorBefore: true,
                 run: () => app.togglePin(id) })
        e.push({ text: i18n("Delete"), icon: "user-trash-symbolic", accel: "Del", run: () => app.deleteItem(id, true) })
        itemMenu.itemId = id
        itemMenu.entries = e
        itemMenu.currentTag = card.tag
        if (px < 0) {
            const p = card.mapToItem(win.contentItem, 8, -8)
            itemMenu.openAt(p.x, p.y, true)
        } else {
            const p = card.mapToItem(win.contentItem, px, py)
            itemMenu.openAt(p.x, p.y, false)
        }
    }

    function openFilterMenu() {
        const e = [{ text: i18n("All"), icon: "edit-select-all-symbolic", current: history.typeFilter === "",
                     run: () => { history.typeFilter = ""; filtersChanged() } }]
        for (const t of app.typeOrder) {
            const type = t
            e.push({ text: app.typeName(type), icon: app.typeIcon(type), current: history.typeFilter === type,
                     run: () => { history.typeFilter = type; filtersChanged() } })
        }
        filterMenu.entries = e
        filterMenu.currentTag = history.tagFilter
        const p = filterButton.mapToItem(win.contentItem, 0, -6)
        filterMenu.openAt(p.x, p.y, true)
        filterMenu.selectedIndex = history.typeFilter ? app.typeOrder.indexOf(history.typeFilter) + 1 : 0
    }

    // ---------- backdrop ----------
    Rectangle {
        anchors.fill: parent
        color: Theme.backdrop
        MouseArea {
            anchors.fill: parent
            acceptedButtons: Qt.AllButtons
            onPressed: app.close()
        }
    }

    // ---------- panel ----------
    Rectangle {
        id: panel
        x: 6
        width: win.width - 12
        y: settings.position === "top" ? 6 : win.height - height - 6
        height: column.implicitHeight + 22
        radius: 18
        color: Theme.panel
        border.width: 1
        border.color: Theme.panelBorder

        MouseArea {     // clicks on the panel itself must not reach the backdrop
            anchors.fill: parent
            acceptedButtons: Qt.AllButtons
        }

        ColumnLayout {
            id: column
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            anchors.topMargin: 10
            spacing: 10

            // header
            RowLayout {
                spacing: 10
                Layout.fillWidth: true

                PillButton {
                    iconName: settings.incognito ? "view-conceal-symbolic" : "view-reveal-symbolic"
                    checked: settings.incognito
                    onClicked: settings.incognito = !settings.incognito
                }
                Item { Layout.fillWidth: true }
                Row {
                    spacing: 6
                    PillButton {
                        id: filterButton
                        iconName: history.typeFilter ? app.typeIcon(history.typeFilter) : "edit-find-symbolic"
                        iconSize: 14
                        checked: history.typeFilter !== "" || history.tagFilter !== ""
                        iconColor: history.tagFilter ? app.tagColor(history.tagFilter) : (hovered || checked ? Theme.text : Theme.text85)
                        anchors.verticalCenter: parent.verticalCenter
                        extra: SymbolicIcon { name: "pan-down-symbolic"; size: 12; color: Theme.text85 }
                        onClicked: win.openFilterMenu()
                        onMiddleClicked: { history.typeFilter = ""; history.tagFilter = ""; win.filtersChanged() }
                    }
                    B.TextField {
                        id: search
                        width: 420
                        anchors.verticalCenter: parent.verticalCenter
                        focus: true
                        color: Theme.text
                        placeholderTextColor: Theme.text50
                        selectionColor: Theme.accent
                        selectedTextColor: Theme.text
                        font.pointSize: Theme.pt(1.0)
                        leftPadding: 14
                        rightPadding: 14
                        topPadding: 7
                        bottomPadding: 7
                        placeholderText: {
                            const hint = []
                            if (history.typeFilter) hint.push(app.typeName(history.typeFilter))
                            if (history.tagFilter) hint.push(app.tagName(history.tagFilter))
                            if (history.pinnedOnly) hint.push(i18n("Pinned"))
                            if (hint.length) return i18n("Search in: %1", hint.join(" · "))
                            return settings.incognito ? i18n("Incognito: nothing new is saved") : i18n("Type to search")
                        }
                        background: Rectangle {
                            radius: height / 2
                            color: win.focusIndex === -1 ? Theme.fill10 : Qt.rgba(1, 1, 1, 0.07)
                            border.width: 1
                            border.color: win.focusIndex === -1 ? Theme.accent : Theme.fill10
                        }
                        onTextChanged: {
                            history.search = text
                            win.setFocus(0)
                        }
                        Keys.onPressed: (event) => win.handleKey(event)
                        WheelHandler {
                            acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
                            onWheel: (event) => {
                                win.wheelAccum += event.angleDelta.y
                                if (Math.abs(win.wheelAccum) < 120) return
                                const step = win.wheelAccum < 0 ? 1 : -1
                                win.wheelAccum = 0
                                if (event.modifiers & Qt.ControlModifier) win.cycleTag(step)
                                else win.cycleType(step)
                            }
                        }
                    }
                    PillButton {
                        iconName: "view-pin-symbolic"
                        iconSize: 14
                        checked: history.pinnedOnly
                        anchors.verticalCenter: parent.verticalCenter
                        onClicked: { history.pinnedOnly = !history.pinnedOnly; win.filtersChanged() }
                    }
                }
                Item { Layout.fillWidth: true }
                Text {
                    text: win.flashText !== "" ? win.flashText : i18np("%1 item", "%1 items", win.count)
                    color: Theme.text55
                    font.pointSize: Theme.pt(0.9)
                }
                PillButton {
                    text: i18n("Clear")
                    bold: true
                    onClicked: clearConfirm.ask()
                }
            }

            // cards
            ListView {
                id: list
                visible: win.count > 0
                Layout.fillWidth: true
                Layout.preferredHeight: settings.itemHeight + 8
                orientation: ListView.Horizontal
                spacing: 10
                topMargin: 2
                model: history
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                cacheBuffer: 3000
                currentIndex: -1
                keyNavigationEnabled: false
                // Keep the focused card centred, like Copyous.
                highlightRangeMode: ListView.ApplyRange
                preferredHighlightBegin: width / 2 - settings.itemWidth / 2
                preferredHighlightEnd: width / 2 + settings.itemWidth / 2
                highlightMoveDuration: 150
                highlightMoveVelocity: -1

                delegate: Card {
                    id: cardDelegate
                    selected: index === win.focusIndex
                    now: win.now
                    playing: win.visible
                    onChosen: (shift, ctrl) => app.choose(itemId, shift, ctrl)
                    onPinToggled: app.togglePin(itemId)
                    onDeleteRequested: win.deleteItem(itemId, false)
                    onMenuRequested: (x, y) => win.openItemMenu(index, cardDelegate, x, y)
                    onTitleEditFinished: (save, title) => {
                        if (save) app.setTitle(itemId, title)
                        search.forceActiveFocus()
                    }
                }

                WheelHandler {
                    acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
                    onWheel: (event) => {
                        const step = settings.itemWidth + 10
                        const d = Math.abs(event.angleDelta.x) > Math.abs(event.angleDelta.y) ? event.angleDelta.x : event.angleDelta.y
                        const pixels = event.pixelDelta.x !== 0 || event.pixelDelta.y !== 0
                            ? -(Math.abs(event.pixelDelta.x) > Math.abs(event.pixelDelta.y) ? event.pixelDelta.x : event.pixelDelta.y)
                            : -d / 120 * step
                        const maxX = Math.max(list.originX, list.contentWidth + list.originX - list.width)
                        list.contentX = Math.max(list.originX, Math.min(maxX, list.contentX + pixels))
                    }
                }
            }

            // empty state
            ColumnLayout {
                visible: win.count === 0
                spacing: 10
                Layout.fillWidth: true
                Layout.preferredHeight: settings.itemHeight + 8
                Item { Layout.fillHeight: true }
                SymbolicIcon {
                    name: history.filtering ? "edit-find-symbolic" : "edit-paste-symbolic"
                    size: 40
                    color: Theme.text45
                    Layout.alignment: Qt.AlignHCenter
                }
                Text {
                    text: history.filtering ? i18n("No items found") : i18n("Clipboard is empty")
                    color: Theme.text45
                    font.bold: true
                    font.pointSize: Theme.pt(1.05)
                    Layout.alignment: Qt.AlignHCenter
                }
                Item { Layout.fillHeight: true }
            }
        }
    }

    // ---------- popups ----------
    PopupMenu {
        id: itemMenu
        property string itemId
        parent: win.contentItem
        showTags: true
        onTagPicked: (tagId) => { close(); app.setTag(itemId, tagId) }
        onDigitPressed: (d) => {
            close()
            if (d === 0) app.clearTag(itemId)
            else app.setTag(itemId, app.tags[d - 1].id)
        }
        onClosed: if (!win.popupOpen) search.forceActiveFocus()
    }
    PopupMenu {
        id: filterMenu
        parent: win.contentItem
        title: i18n("Filter")
        showTags: true
        onTagPicked: (tagId) => {
            close()
            history.tagFilter = history.tagFilter === tagId ? "" : tagId
            win.filtersChanged()
        }
        onClosed: if (!win.popupOpen) search.forceActiveFocus()
    }
    Editor {
        id: editor
        parent: win.contentItem
        onSaved: (itemId, text) => app.updateContent(itemId, text)
        onClosed: search.forceActiveFocus()
    }
    ClearConfirm {
        id: clearConfirm
        parent: win.contentItem
        onConfirmed: (includeProtected) => { app.clearHistory(includeProtected); win.setFocus(0) }
        onClosed: search.forceActiveFocus()
    }
}
