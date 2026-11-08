// Keyboard-driven popup menu inside the bar window.
// entries: [{ text, icon, accel, current, separatorBefore, run: function }]
import QtQuick
import QtQuick.Controls.Basic as B
import QtQuick.Layouts

B.Popup {
    id: menu
    property string title
    property var entries: []
    property bool showTags: false
    property string currentTag
    property int selectedIndex: 0
    signal tagPicked(string tagId)
    signal digitPressed(int digit)      // 1..9, 0

    padding: 8
    modal: true
    dim: false
    focus: true
    closePolicy: B.Popup.CloseOnEscape | B.Popup.CloseOnPressOutside

    background: Rectangle {
        color: Theme.menu
        radius: 14
        border.width: 1
        border.color: Theme.menuBorder
    }

    contentItem: ColumnLayout {
        spacing: 1
        focus: true
        Keys.onPressed: (event) => menu.handleKey(event)

        Text {
            visible: menu.title !== ""
            text: menu.title
            color: Theme.text60
            font.pointSize: Theme.pt(0.9)
            font.bold: true
            leftPadding: 10
            topPadding: 4
            bottomPadding: 6
        }
        TagRow {
            visible: menu.showTags
            current: menu.currentTag
            onPicked: (tagId) => menu.tagPicked(tagId)
        }
        Rectangle {
            visible: menu.showTags
            color: Theme.fill10
            implicitHeight: 1
            Layout.fillWidth: true
            Layout.margins: 5
            Layout.leftMargin: 6
            Layout.rightMargin: 6
        }
        Repeater {
            model: menu.entries
            ColumnLayout {
                id: slot
                required property var modelData
                required property int index
                spacing: 1
                Layout.fillWidth: true
                Rectangle {
                    visible: !!slot.modelData.separatorBefore
                    color: Theme.fill10
                    implicitHeight: 1
                    Layout.fillWidth: true
                    Layout.topMargin: 5
                    Layout.bottomMargin: 5
                    Layout.leftMargin: 6
                    Layout.rightMargin: 6
                }
                MenuEntry {
                    text: slot.modelData.text
                    iconName: slot.modelData.icon || ""
                    accel: slot.modelData.accel || ""
                    current: !!slot.modelData.current
                    selected: menu.selectedIndex === slot.index
                    Layout.fillWidth: true
                    Layout.minimumWidth: 250
                    onHoveredIn: menu.selectedIndex = slot.index
                    onTriggered: menu.run(slot.index)
                }
            }
        }
    }

    function run(i) {
        const e = entries[i]
        close()
        // After the menu's own closing (which gives the focus back to the search box).
        if (e && e.run) Qt.callLater(e.run)
    }

    function handleKey(event) {
        const n = entries.length
        if (event.key === Qt.Key_Escape) { close(); event.accepted = true; return }
        if (event.key === Qt.Key_Down && n) { selectedIndex = (selectedIndex + 1) % n; event.accepted = true; return }
        if (event.key === Qt.Key_Up && n) { selectedIndex = (selectedIndex - 1 + n) % n; event.accepted = true; return }
        if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) {
            if (selectedIndex >= 0 && selectedIndex < n) run(selectedIndex)
            event.accepted = true
            return
        }
        // Digits by key position (works with any layout): scan codes 10..19 are 1..9, 0.
        const code = event.nativeScanCode
        if (code >= 10 && code <= 19) {
            digitPressed(code === 19 ? 0 : code - 9)
            event.accepted = true
            return
        }
        event.accepted = true
    }

    // Place at (x, y) in the parent's coordinates, kept inside the window.
    function openAt(px, py, above) {
        selectedIndex = 0
        const w = implicitWidth, h = implicitHeight
        const pw = parent ? parent.width : w, ph = parent ? parent.height : h
        x = Math.max(8, Math.min(pw - w - 8, px))
        y = Math.max(8, Math.min(ph - h - 8, above ? py - h : py))
        open()
        contentItem.forceActiveFocus()
    }
}
