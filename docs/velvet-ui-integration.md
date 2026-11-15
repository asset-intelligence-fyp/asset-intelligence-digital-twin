# Velvet UI integration

Based on `llm_integration` commit `905b19bece9ca39a09240be7c6931448a099d93f`.
The uploaded `src.zip` supplies the indigo/velvet presentation, scene-weather controls,
numbered BIM markers, exterior effects and page-scroll gesture changes.

## Integration choices

- Keep the current validated 18-point room assistant and all backend/LLM modules.
- Keep HTTP telemetry as the initial source, the source switch, live coverage and storage status.
- Keep replay, what-if scenarios, comfort evidence, command search and the light/dark toggle.
- Default to the velvet dark theme on first use; retain an explicitly selected light theme.
- Weather controls affect only the scene. They do not alter telemetry, call a weather service,
  or provide weather evidence to the room assistant.
- Pause browser demo affects only the browser generator. Stop the Python simulator in its
  Terminal to stop HTTP readings. Existing Simulator controls still select either source.
- Plain scrolling moves the page. Ctrl/Command + scroll zooms the viewer; Shift + scroll pans.
- Numbered markers use the same canonical 18 sensor identities and IFC mappings.

No database, model asset, simulator output, dependency or chatbot-reliability changes are
included. The chatbot findings in the separate improvement list remain outstanding.

## Run

Use the existing installation and local Ollama setup:

```bash
npm ci
TWIN_STORAGE=memory npm run dev
```

## Verification

- Production TypeScript/Vite build passed.
- 27 existing integration/navigation/experience tests passed.
- 11 focused assistant/UI checks passed, including three new weather, scroll and marker tests.
- 23 existing Python room-assistant checks passed.
- Browser review covered all six pages, HTTP coverage, weather selection and the current
  chatbot panel. WebGL 2 was unavailable in the preview browser, so rendered building/rain
  appearance still needs checking on a graphics-capable browser. Local Qwen inference was
  not available in that preview; backend and assistant contracts were checked with tests.

## Existing local edits

Stop `npm run dev` before changing branches. Preserve uncommitted simulator outputs and
`TODO.md` with a named stash including untracked files; apply that stash after switching.
Only commit intended source or task-list changes. Runtime CSV/JSON files are not part of
this UI integration.
