// A theme icon; symbolic ones are recoloured (image://icon/<name>?color=...).
import QtQuick
import QtQuick.Window

Image {
    id: root
    property string name
    property color color: Theme.text
    property bool recolor: true
    property int size: 16

    width: size
    height: size
    fillMode: Image.PreserveAspectFit
    smooth: true
    asynchronous: false
    sourceSize: Qt.size(size * Screen.devicePixelRatio, size * Screen.devicePixelRatio)
    source: name ? "image://icon/" + name + (recolor ? "?color=" + root.color.toString().slice(1) : "") : ""
}
