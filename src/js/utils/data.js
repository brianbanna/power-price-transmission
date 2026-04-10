// Fetches a preprocessed JSON artefact from `data/processed/`.
//
// The page is served from `src/`, so processed data is one directory up.
// Using a relative URL keeps the site portable across deployment roots.

const BASE_PATH = "../data/processed/";

export async function loadJSON(filename) {
    const url = BASE_PATH + filename;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`failed to load ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
}
