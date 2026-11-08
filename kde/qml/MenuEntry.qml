// One row of a popup menu: icon, label, shortcut hint.
import QtQuick
import QtQuick.Layouts

Rectangle {
    id: entry
    property string iconName
    property string text
    property string accel
    property bool selected: false
    property bool current: false
    signal triggered()
    signal hoveredIn()

    implicitWidth: row.implicitWidth + 20
    implicitHeight: Math.max(32, row.implicitHeight + 12)
    radius: 8
    color: selected ? Theme.fill10 : "transparent"

    RowLayout {
        id: row
        anchors.fill: parent
        anchors.leftMargin: 10
        anchors.rightMargin: 10
        spacing: 10
        SymbolicIcon {
            name: entry.iconName
            size: 16
            color: entry.current ? Theme.current : Theme.text
            opacity: entry.iconName ? 1 : 0
        }
        Text {
            text: entry.text
            color: entry.current ? Theme.current : Theme.text
            font.pointSize: Theme.pt(0.95)
            Layout.fillWidth: true
        }
        Text {
            visible: entry.accel !== ""
            text: entry.accel
            color: Theme.text45
            font.pointSize: Theme.pt(0.82)
        }
    }
    HoverHandler {
        onHoveredChanged: if (hovered) entry.hoveredIn()
    }
    MouseArea {
        anchors.fill: parent
        onClicked: entry.triggered()
    }
}
