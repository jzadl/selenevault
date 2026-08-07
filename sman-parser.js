function esc(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function parseSman(text){
  const lines = text.split("\n");
  let about = "";
  const entries = [];
  let entry = null;
  let inContent = false;
  let contentLines = [];
  let lastKey = null;

  function flushContent(){
    if(entry && inContent){
      entry.content = contentLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    inContent = false;
    contentLines = [];
  }
  function push(){
    flushContent();
    if(entry && entry.name) entries.push(entry);
    entry = null;
    lastKey = null;
  }

  for(let raw of lines){
    if(inContent){
      if(raw.match(/^\s+\S/) || raw.trim() === ""){
        contentLines.push(raw.replace(/^  /, ""));
        continue;
      }
      flushContent();
    }
    const line = raw.trim();
    if(!line) continue;
    if(line.startsWith("#")) continue; // comment
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if(!kv){
      // indented continuation of the previous value
      if(raw.match(/^\s+\S/) && entry && lastKey){
        entry[lastKey] += " " + line;
      }
      continue;
    }
    const key = kv[1].toLowerCase(), val = kv[2].trim();
    if(key === "about" && !entry){ about = val; continue; }
    if(key === "name"){ push(); entry = { name: val }; lastKey = "name"; continue; }
    if(key === "content"){ inContent = true; contentLines = []; lastKey = "content"; continue; }
    if(entry){ entry[key] = val; lastKey = key; }
  }
  push();
  return { about, entries };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseSman, esc };
}
