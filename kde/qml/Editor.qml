// Edit an item's text (Ctrl+E).
import QtQuick
import QtQuick.Controls.Basic as B
import QtQuick.Layouts

B.Popup {
    id: editor
    property string itemId
    property bool mono: false
    signal saved(string itemId, string text)

    padding: 16
    modal: true
    dim: false
    focus: true
    closePolicy: B.Popup.CloseOnEscape

    background: Rectangle {
        color: Theme.menu
        radius: 14
        border.width: 1
        border.color: Theme.menuBorder
    }

    contentItem: ColumnLayout {
        spacing: 12
        Text {
            text: i18n("Edit item")
            color: Theme.text
            font.bold: true
            font.pointSize: Theme.pt(1.1)
        }
        B.ScrollView {
            id: scroll
            Layout.fillWidth: true
            Layout.preferredHeight: Math.min(420, Math.max(160, area.implicitHeight + 4))
            B.TextArea {
                id: area
                wrapMode: TextEdit.WrapAtWordBoundaryOrAnywhere
                color: Theme.text
                selectionColor: Theme.accent
                selectedTextColor: Theme.text
                font.family: editor.mono ? Theme.mono : Qt.application.font.family
                font.pointSize: Theme.pt(editor.mono ? 0.9 : 1.0)
                padding: 10
                selectByMouse: true
                persistentSelection: true
                background: Rectangle { radius: 8; color: Qt.rgba(0, 0, 0, 0.25) }
                Keys.onPressed: (event) => {
                    const ctrl = event.modifiers & Qt.ControlModifier
                    if (event.key === Qt.Key_Escape) { editor.close(); event.accepted = true }
                    else if (ctrl && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_S)) { editor.save(); event.accepted = true }
                    else if (ctrl && event.key === Qt.Key_Tab) { area.insert(area.cursorPosition, "\t"); event.accepted = true }
                }
            }
        }
        RowLayout {
            spacing: 8
            Text {
                text: i18n("Ctrl+Enter saves · Esc cancels")
                color: Theme.text45
                font.pointSize: Theme.pt(0.82)
                Layout.fillWidth: true
            }
            PillButton { kind: "dialog"; text: i18n("Cancel"); onClicked: editor.close() }
            PillButton { kind: "suggested"; text: i18n("Save"); onClicked: editor.save() }
        }
    }

    function edit(id, text, isCode) {
        itemId = id
        mono = isCode
        area.text = text
        const pw = parent ? parent.width : 800, ph = parent ? parent.height : 600
        width = Math.min(760, pw - 80)
        x = (pw - width) / 2
        y = Math.max(8, Math.min(ph * 0.18, ph - implicitHeight - 8))
        open()
        area.forceActiveFocus()
        area.cursorPosition = area.length
    }

    function save() {
        const t = area.text
        close()
        saved(itemId, t)
    }
}
