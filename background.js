chrome.scripting.executeScript({
    target: {tabId: id, allFrames: true},
    files: ['content_scripts/cscript.js'],
});