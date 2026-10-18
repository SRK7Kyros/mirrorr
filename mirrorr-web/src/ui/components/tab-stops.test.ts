import { afterEach, describe, expect, it } from "vitest";
import { arrowStop, syncTabStops } from "./tab-stops";

function mount(html: string): void {
  document.body.innerHTML = html;
  syncTabStops(document.body);
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`no #${id}`);
  return found;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("arrowStop", () => {
  it("walks the map's order, skipping what Tab skips", () => {
    mount(`
      <button id="first" class="tab-stop">First</button>
      <button id="skipped" class="tab-skip">Hidden</button>
      <button id="unmarked">Unmarked</button>
      <button id="disabled" class="tab-stop" disabled>Disabled</button>
      <button id="last" class="tab-stop">Last</button>
    `);

    expect(arrowStop(element("first"), 1)).toBe(element("last"));
    expect(arrowStop(element("last"), -1)).toBe(element("first"));
    expect(arrowStop(element("first"), -1)).toBeNull();
    expect(arrowStop(element("last"), 1)).toBeNull();
  });

  it("stays put on a control that owns the arrow keys", () => {
    mount(`
      <button id="above" class="tab-stop">Above</button>
      <input id="field" class="tab-stop" />
      <div role="listbox" id="list" class="tab-stop">
        <div role="option" tabindex="0" id="option">Option</div>
      </div>
      <button id="below" class="tab-stop">Below</button>
    `);

    expect(arrowStop(element("field"), 1)).toBeNull();
    expect(arrowStop(element("option"), 1)).toBeNull();
  });

  it("stays inside the open dialog", () => {
    mount(`
      <div role="dialog">
        <button id="inside" class="tab-stop">Inside</button>
      </div>
      <button id="outside" class="tab-stop">Outside</button>
    `);

    expect(arrowStop(element("inside"), 1)).toBeNull();
    expect(arrowStop(element("outside"), 1)).toBeNull();
  });

  it("never lands on a focus guard", () => {
    mount(`
      <button id="only" class="tab-stop">Only</button>
      <span data-radix-focus-guard tabindex="0"></span>
    `);

    expect(arrowStop(element("only"), 1)).toBeNull();
  });

  it("has nowhere to go from nothing", () => {
    mount('<button id="only" class="tab-stop">Only</button>');

    expect(arrowStop(null, 1)).toBeNull();
    expect(arrowStop(document.body, 1)).toBeNull();
  });
});
