// Translations: English in the code, others in po/ (compiled to ~/.local/share/locale by install.sh).
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;

const UUID = 'copy-addict@kbrianps';
Gettext.bindtextdomain(UUID, GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'locale']));

// global.__copyAddictEnglish forces English (used to take the README screenshot).
function _(text) {
    return global.__copyAddictEnglish ? text : Gettext.dgettext(UUID, text);
}

function ngettext(singular, plural, n) {
    if (global.__copyAddictEnglish) return n === 1 ? singular : plural;
    return Gettext.dngettext(UUID, singular, plural, n);
}
