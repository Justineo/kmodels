const [command, source, url] = process.argv.slice(2);
if (command !== "fetch" || !source || process.argv.length > 5)
  throw new Error("Expected fetch SOURCE_ID [RESEARCH_URL]");
const response = await fetch("http://127.0.0.1:8765/source", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ source, url }),
});
const text = await response.text();
if (!response.ok) throw new Error(text);
console.log(text);
