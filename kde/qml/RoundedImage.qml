// Image or animated GIF with rounded corners.
import QtQuick
import QtQuick.Effects
import QtQuick.Window

Item {
    id: root
    property url source
    property bool animated: false
    property bool playing: true
    property bool crop: true            // cover (crop) or contain
    property real radius: 8
    readonly property bool ready: loader.item ? loader.item.status === Image.Ready : false
    readonly property bool failed: loader.item ? loader.item.status === Image.Error : false

    Loader {
        id: loader
        anchors.fill: parent
        visible: false
        layer.enabled: true
        sourceComponent: root.animated ? animatedImage : stillImage
    }
    Component {
        id: stillImage
        Image {
            source: root.source
            asynchronous: true
            cache: false
            fillMode: root.crop ? Image.PreserveAspectCrop : Image.PreserveAspectFit
            sourceSize: Qt.size(Math.max(1, root.width) * Screen.devicePixelRatio, Math.max(1, root.height) * Screen.devicePixelRatio)
            smooth: true
            mipmap: true
        }
    }
    Component {
        id: animatedImage
        AnimatedImage {
            source: root.source
            asynchronous: true
            cache: false
            playing: root.playing && root.visible
            fillMode: root.crop ? Image.PreserveAspectCrop : Image.PreserveAspectFit
            smooth: true
        }
    }
    Item {
        id: mask
        anchors.fill: parent
        visible: false
        layer.enabled: true
        Rectangle {
            // Round the visible picture, not the empty bands of a fitted image.
            readonly property var img: loader.item
            readonly property real pw: img && !root.crop && img.paintedWidth > 0 ? img.paintedWidth : root.width
            readonly property real ph: img && !root.crop && img.paintedHeight > 0 ? img.paintedHeight : root.height
            width: pw
            height: ph
            anchors.centerIn: parent
            radius: root.radius
        }
    }
    MultiEffect {
        anchors.fill: parent
        source: loader
        maskEnabled: true
        maskSource: mask
        maskThresholdMin: 0.5
        maskSpreadAtMin: 1.0
    }
}
