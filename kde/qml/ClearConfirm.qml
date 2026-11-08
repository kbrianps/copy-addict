// "Clear history?" with the option to also remove pinned and tagged items.
import QtQuick
import QtQuick.Controls.Basic as B
import QtQuick.Layouts

B.Popup {
    id: dialog
    property bool includeProtected: false
    signal confirmed(bool includeProtected)

    padding: 16
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
        spacing: 12
        focus: true
        Keys.onPressed: (event) => {
            if (event.key === Qt.Key_Escape) dialog.close()
            else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) dialog.accept()
            else if (event.key === Qt.Key_Space) dialog.includeProtected = !dialog.includeProtected
            event.accepted = true
        }
        Text {
            text: i18n("Clear history?")
            color: Theme.text
            font.bold: true
            font.pointSize: Theme.pt(1.1)
        }
        Text {
            text: i18n("Deleted items cannot be recovered.")
            color: Theme.text70
            font.pointSize: Theme.pt(0.95)
        }
        Rectangle {
            radius: 8
            color: checkHover.hovered ? Theme.fill08 : "transparent"
            implicitWidth: checkRow.implicitWidth + 8
            implicitHeight: checkRow.implicitHeight + 8
            RowLayout {
                id: checkRow
                anchors.centerIn: parent
                spacing: 8
                SymbolicIcon { name: dialog.includeProtected ? "checkbox-checked-symbolic" : "checkbox-symbolic"; size: 16 }
                Text { text: i18n("Also delete pinned and tagged items"); color: Theme.text; font.pointSize: Theme.pt(0.95) }
            }
            HoverHandler { id: checkHover; cursorShape: Qt.PointingHandCursor }
            MouseArea { anchors.fill: parent; onClicked: dialog.includeProtected = !dialog.includeProtected }
        }
        RowLayout {
            spacing: 8
            Item { Layout.fillWidth: true }
            PillButton { kind: "dialog"; text: i18n("Cancel"); onClicked: dialog.close() }
            PillButton { kind: "destructive"; text: i18n("Clear"); onClicked: dialog.accept() }
        }
    }

    function ask() {
        includeProtected = false
        const pw = parent ? parent.width : 800, ph = parent ? parent.height : 600
        x = (pw - implicitWidth) / 2
        y = Math.max(8, Math.min(ph * 0.3, ph - implicitHeight - 8))
        open()
        contentItem.forceActiveFocus()
    }

    function accept() {
        close()
        confirmed(includeProtected)
    }
}
