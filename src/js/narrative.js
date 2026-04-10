// Narrative scroll orchestration stub. Real scrollama wiring lands in Task 2.6.
//
// The signature mirrors createMap — callers pass the host selector and a
// config bag containing anything needed to react to scroll events.

export function initNarrative(selector, config) {
    const container = document.querySelector(selector);
    if (!container) {
        throw new Error(`initNarrative: no element matches ${selector}`);
    }

    // Temporary: render nothing, just acknowledge the handshake.
    container.dataset.ready = "true";

    return {
        map: config.map,
        steps: [],
    };
}
