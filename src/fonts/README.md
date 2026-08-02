# Bundled fonts

soup bundles three fonts, one per document "Font" setting. All are licensed under
the **SIL Open Font License 1.1**; the full license text (including each font's
required copyright notice) sits beside the woff2 files:

| Menu option | Family          | File                            | License                | Source |
| ----------- | --------------- | ------------------------------- | ---------------------- | ------ |
| Sketch      | Shantell Sans   | `shantell-sans-latin-400.woff2` | `OFL-ShantellSans.txt` | https://github.com/arrowtype/shantell-sans |
| Serif       | Lora            | `lora-latin-400.woff2`          | `OFL-Lora.txt`         | https://github.com/cyrealtype/Lora-Cyrillic |
| Sans-serif  | Inter           | `inter-latin-400.woff2`         | `OFL-Inter.txt`        | https://github.com/rsms/inter |

The woff2 files are the Latin-subset, weight-400 builds from
[Fontsource](https://fontsource.org). The OFL requires the license + copyright
notice to travel with the font (done here); it does **not** govern documents made
with the fonts, nor the rest of this app — the fonts stay under the OFL while the
app keeps its own license.

Only **Lora** carries a Reserved Font Name ("Lora"); Inter and Shantell Sans
declare none. The OFL's name restriction only limits what a *modified* copy of the
font may be called — it doesn't constrain UI labels, so exposing these as
"Sketch"/"Serif"/"Sans-serif" in the menu is fine.
