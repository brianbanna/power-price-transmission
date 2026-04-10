// Map module stub. The real renderer lands in Task 3.1.
//
// Exports a factory that takes a CSS selector and config and returns a
// controller object the rest of the app uses to drive state changes:
//
//     const map = createMap("#map-container", { topology });
//     map.update({ hour: 13, date: "2024-05-12" });
//     map.destroy();

export function createMap(selector, config) {
    const container = document.querySelector(selector);
    if (!container) {
        throw new Error(`createMap: no element matches ${selector}`);
    }

    const state = {
        topology: config.topology,
        currentHour: null,
    };

    function update(next) {
        Object.assign(state, next);
    }

    function destroy() {
        container.replaceChildren();
    }

    return { update, destroy };
}
