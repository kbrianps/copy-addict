cmake_minimum_required(VERSION 3.22)
project(copy-addict VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

find_package(ECM 6.0 REQUIRED NO_MODULE)
list(APPEND CMAKE_MODULE_PATH ${ECM_MODULE_PATH})
include(GNUInstallDirs)
include(ECMFindQmlModule)

find_package(Qt6 6.6 REQUIRED COMPONENTS Core Gui Qml Quick QuickControls2 Widgets DBus Network WaylandClient Concurrent)
find_package(KF6 6.0 REQUIRED COMPONENTS GuiAddons GlobalAccel StatusNotifierItem I18n)
find_package(LayerShellQt REQUIRED)
find_package(Wayland REQUIRED COMPONENTS Client)
find_package(WaylandScanner REQUIRED)

find_file(FAKE_INPUT_XML fake-input.xml PATHS /usr/share/plasma-wayland-protocols REQUIRED)

qt_policy(SET QTP0001 NEW)
qt_policy(SET QTP0004 NEW)

qt_add_executable(copy-addict
    src/main.cpp
    src/app.cpp src/app.h
    src/settings.cpp src/settings.h
    src/store.cpp src/store.h
    src/filtermodel.cpp src/filtermodel.h
    src/capture.cpp src/capture.h
    src/highlighter.cpp src/highlighter.h
    src/linkpreview.cpp src/linkpreview.h
    src/paster.cpp src/paster.h
    src/kwinbridge.cpp src/kwinbridge.h
    src/tray.cpp src/tray.h
    src/iconprovider.cpp src/iconprovider.h
    src/util.cpp src/util.h
)

ecm_add_wayland_client_protocol(copy-addict PROTOCOL ${FAKE_INPUT_XML} BASENAME fake-input)
target_include_directories(copy-addict PRIVATE ${CMAKE_CURRENT_BINARY_DIR})

set_source_files_properties(qml/Theme.qml PROPERTIES QT_QML_SINGLETON_TYPE TRUE)

qt_add_qml_module(copy-addict
    URI CopyAddict
    VERSION 1.0
    NO_IMPORT_SCAN
    QML_FILES
        qml/Theme.qml
        qml/Bar.qml
        qml/Card.qml
        qml/CardBody.qml
        qml/SymbolicIcon.qml
        qml/PillButton.qml
        qml/PopupMenu.qml
        qml/MenuEntry.qml
        qml/TagRow.qml
        qml/Editor.qml
        qml/ClearConfirm.qml
        qml/RoundedImage.qml
        qml/SettingsWindow.qml
    RESOURCES
        kwin/tracker.js
        src/hl-helpers.js
)

target_link_libraries(copy-addict PRIVATE
    Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::QuickControls2 Qt6::Widgets Qt6::DBus Qt6::Network
    Qt6::WaylandClient Qt6::Concurrent
    KF6::GuiAddons KF6::GlobalAccel KF6::StatusNotifierItem KF6::I18n KF6::I18nQml
    LayerShellQt::Interface
    Wayland::Client
)
target_compile_definitions(copy-addict PRIVATE
    TRANSLATION_DOMAIN="copy-addict"
    COPY_ADDICT_VERSION="${PROJECT_VERSION}"
)

install(TARGETS copy-addict RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
ki18n_install(po)
