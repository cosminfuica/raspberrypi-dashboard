// Scaffold placeholder: proves the backend serves this build and the API answers.
// The frontend task replaces this file.
const app = document.getElementById('app')

fetch('/api/info')
  .then((r) => r.json())
  .then((info) => {
    app.textContent = `pidash API v${info.api_version} (app ${info.app_version})`
  })
  .catch((err) => {
    app.textContent = `API unreachable: ${err}`
  })
