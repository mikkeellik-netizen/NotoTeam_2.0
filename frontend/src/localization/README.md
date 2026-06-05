# Localization modules

This folder is reserved for future language packs and localization modules.

Current state:
- `settingsStore.language` stores the selected language.
- The settings UI exposes a compact language selector.
- No runtime auto-translation is enabled here, so existing UI rendering remains stable.

Future safe path:
1. Add typed dictionaries per feature, not a global DOM translator.
2. Translate one module at a time, starting with settings.
3. Keep user-generated content untouched.
4. Add fallback to Russian for missing keys.
