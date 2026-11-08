// Rounded header / dialog button: optional icon, optional label.
import QtQuick

Rectangle {
    id: root
    property string iconName
    property int iconSize: 16
    property string text
    property bool checked: false
    property bool bold: false
    property string kind: "header"      // header | dialog | suggested | destructive | mini
    property color tint: "transparent"  // overrides the checked colour (tags)
    property color iconColor: (hover.hovered || checked) ? Theme.text : (kind === "mini" ? Theme.text60 : Theme.text85)
    property alias hovered: hover.hovered
    property real hPadding: kind === "mini" ? 3 : (kind === "header" ? 12 : 18)
    property alias extra: extraRow.data
    signal clicked(var mouse)
    signal middleClicked()

    implicitWidth: row.implicitWidth + 2 * hPadding
    implicitHeight: Math.max(row.implicitHeight + (kind === "mini" ? 6 : 14), kind === "mini" ? 20 : 30)
    radius: height / 2
    color: {
        if (kind === "suggested") return hover.hovered ? Theme.accentHover : Theme.accent
        if (kind === "destructive") return hover.hovered ? Theme.destructiveHover : Theme.destructive
        if (checked) return tint.a > 0 ? tint : (kind === "mini" ? Theme.accent : Theme.checked)
        if (kind === "mini") return hover.hovered ? Theme.fill14 : "transparent"
        if (kind === "dialog") return hover.hovered ? Theme.fill18 : Theme.fill10
        return hover.hovered ? Theme.fill16 : Theme.fill08
    }

    Row {
        id: row
        anchors.centerIn: parent
        spacing: 6
        SymbolicIcon {
            visible: root.iconName !== ""
            name: root.iconName
            size: root.iconSize
            color: root.iconColor
            anchors.verticalCenter: parent.verticalCenter
        }
        Text {
            visible: root.text !== ""
            text: root.text
            color: (hover.hovered || root.checked || root.kind !== "header") ? Theme.text : Theme.text85
            font.pointSize: Theme.pt(root.kind === "header" ? 0.95 : 0.95)
            font.bold: root.bold || root.kind !== "header"
            anchors.verticalCenter: parent.verticalCenter
        }
        Row {
            id: extraRow
            spacing: 4
            anchors.verticalCenter: parent.verticalCenter
        }
    }

    HoverHandler { id: hover; cursorShape: Qt.PointingHandCursor }
    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.MiddleButton
        onClicked: (mouse) => {
            if (mouse.button === Qt.MiddleButton) root.middleClicked()
            else root.clicked(mouse)
        }
    }
}
