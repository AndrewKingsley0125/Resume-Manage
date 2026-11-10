// Control panel entry. Screens:
//   profiles.js   profile cards (Edit / Open)
//   editor.js     profile editor
//   workspace.js  one tab per job link: job site | ChatGPT
//   asks.js       questions from the runs (review, submit, manual steps, Rescan)
import { showScreen } from './state.js';
import { initProfiles, loadProfiles } from './profiles.js';
import { initEditor } from './editor.js';
import { initWorkspace } from './workspace.js';
import { initAsks } from './asks.js';

initProfiles();
initEditor();
initWorkspace();
initAsks();
loadProfiles();
showScreen('profiles');
