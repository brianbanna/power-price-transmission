// Fetches a preprocessed JSON artefact from the site's data directory.
//
// Processed JSON lives at `docs/data/processed/` so GitHub Pages can serve
// the site and its data from a single root folder.

const BASE_PATH = "data/processed/";

export async function loadJSON(filename) {
    const url = BASE_PATH + filename;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`failed to load ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
}
