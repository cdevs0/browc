/*
Features:
Supported src attribute
*/
/*
 * browc-preprocessor.js
 *
 * BrowC C99 Preprocessor
 *
 * The language being preprocessed is C.
 *
 * BrowC-specific behavior:
 *
 *   #include <x.h>
 *       -> BrowC standard-library repository
 *
 *   #include "x.h"
 *       -> search every:
 *
 *          <script type="text/x-c" filename="x.h">
 *
 *       -> if not found, search BrowC standard-library repository
 *
 * The preprocessor does NOT interpret "dom", createelement(), etc.
 * Those belong to browser.h and the BrowC compiler/runtime.
 *
 * This implementation intentionally operates on preprocessing tokens
 * rather than using regular-expression macro replacement.
 */
"use strict";

/* ============================================================================
 * BrowC environment bootstrap (Node + browser, both with DOM access)
 * ============================================================================
 * In a browser, `window`/`document` already exist and this block does
 * nothing. Under plain Node.js (no jsdom, no browser host), this installs a
 * small self-contained DOM so the exact same browc.js file can run C
 * programs that use browser.h (dom, createelement(), appendchild(), etc.)
 * headlessly via `node` or `import()`, with no external stubbing required.
 * If a real DOM (native browser, or something like jsdom) is already
 * present, none of this runs and that real DOM is used untouched.
 * ========================================================================== */
function myFetch(url) {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  try {
    xhr.send();
    if (xhr.status >= 200 && xhr.status < 300) {
      return xhr.responseText;
    }
    console.error("Request failed with status " + xhr.status);
    return null;
  } catch (error) {
    console.error("Network error or request blocked:", error);
    return null;
  }
}
function resolveExternalCScripts() {
  const scripts = document.querySelectorAll('script[type="text/x-c"][src]');
  for (const script of scripts) {
    const src = script.getAttribute("src");
    const response = myFetch(src);
    if (response === null) {
      throw new Error("File not found: " + src);
    }
    script.textContent = response;
    script.removeAttribute("src");
  }
}
resolveExternalCScripts();
(function bootstrapBrowCEnvironment(root) {
  if (
    typeof root.document !== "undefined" &&
    typeof root.window !== "undefined"
  ) {
    return; // real DOM already present (browser, or host-provided jsdom, etc.)
  }

  class BrowCMiniClassList {
    constructor(el) {
      this._el = el;
    }
    _read() {
      return (this._el.attributes.class || "").split(/\s+/).filter(Boolean);
    }
    _write(list) {
      this._el.attributes.class = list.join(" ");
    }
    add(name) {
      const list = this._read();
      if (!list.includes(name)) list.push(name);
      this._write(list);
    }
    remove(name) {
      this._write(this._read().filter((c) => c !== name));
    }
    toggle(name) {
      const list = this._read();
      const has = list.includes(name);
      this._write(has ? list.filter((c) => c !== name) : [...list, name]);
      return !has;
    }
    contains(name) {
      return this._read().includes(name);
    }
  }

  class BrowCMiniNode {
    constructor(tagName) {
      this.tagName = String(tagName || "").toUpperCase();
      this.nodeName = this.tagName;
      this.attributes = Object.create(null);
      this.childNodes = [];
      this.parentNode = null;
      this._text = "";
      this.style = {};
      this.value = "";
      this._listeners = Object.create(null);
      this.classList = new BrowCMiniClassList(this);
    }
    get children() {
      return this.childNodes;
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get id() {
      return this.attributes.id || "";
    }
    set id(v) {
      this.attributes.id = String(v);
    }
    get className() {
      return this.attributes.class || "";
    }
    set className(v) {
      this.attributes.class = String(v);
    }
    get textContent() {
      if (this.childNodes.length === 0) return this._text;
      return this.childNodes.map((c) => c.textContent || "").join("");
    }
    set textContent(text) {
      this._text = String(text);
      this.childNodes = [];
    }
    get innerHTML() {
      return this._html || "";
    }
    set innerHTML(html) {
      this._html = String(html);
    }
    setAttribute(name, value) {
      this.attributes[String(name)] = String(value);
    }
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    }
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name);
    }
    removeAttribute(name) {
      delete this.attributes[name];
    }
    appendChild(child) {
      if (child.parentNode) {
        const idx = child.parentNode.childNodes.indexOf(child);
        if (idx !== -1) child.parentNode.childNodes.splice(idx, 1);
      }
      this.childNodes.push(child);
      child.parentNode = this;
      return child;
    }
    insertBefore(child, refChild) {
      const idx = refChild ? this.childNodes.indexOf(refChild) : -1;
      if (idx === -1) return this.appendChild(child);
      this.childNodes.splice(idx, 0, child);
      child.parentNode = this;
      return child;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx !== -1) this.childNodes.splice(idx, 1);
      child.parentNode = null;
      return child;
    }
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    removeEventListener(type, fn) {
      if (!this._listeners[type]) return;
      this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
    }
    dispatchEvent(event) {
      const type = event && event.type;
      for (const fn of this._listeners[type] || []) {
        try {
          fn.call(this, event);
        } catch (err) {
          console.error(err);
        }
      }
      return true;
    }
    focus() {}
    _matches(selector) {
      selector = selector.trim();
      if (selector.startsWith("#")) return this.id === selector.slice(1);
      if (selector.startsWith("."))
        return this.classList.contains(selector.slice(1));
      const attrMatch = selector.match(
        /^([a-zA-Z0-9_-]*)\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]*)["']?)?\]$/
      );
      if (attrMatch) {
        const [, tag, attr, val] = attrMatch;
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        if (!this.hasAttribute(attr)) return false;
        if (val !== undefined && this.getAttribute(attr) !== val) return false;
        return true;
      }
      return this.tagName === selector.toUpperCase();
    }
    _walk(fn) {
      for (const child of this.childNodes) {
        fn(child);
        child._walk(fn);
      }
    }
    querySelector(selector) {
      let found = null;
      this._walk((node) => {
        if (!found && node._matches(selector)) found = node;
      });
      return found;
    }
    querySelectorAll(selector) {
      const out = [];
      this._walk((node) => {
        if (node._matches(selector)) out.push(node);
      });
      return out;
    }
    getElementById(id) {
      return this.querySelector("#" + id);
    }
  }

  const documentElement = new BrowCMiniNode("html");
  const head = new BrowCMiniNode("head");
  const body = new BrowCMiniNode("body");
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const miniDocument = {
    documentElement,
    head,
    body,
    title: "",
    createElement: (tag) => new BrowCMiniNode(tag),
    createTextNode: (text) => {
      const n = new BrowCMiniNode("#text");
      n._text = String(text);
      n.textContent = String(text);
      return n;
    },
    getElementById: (id) => documentElement.getElementById(id),
    querySelector: (sel) => documentElement.querySelector(sel),
    querySelectorAll: (sel) => documentElement.querySelectorAll(sel),
    addEventListener: (type, fn) => documentElement.addEventListener(type, fn),
    removeEventListener: (type, fn) =>
      documentElement.removeEventListener(type, fn),
  };

  const listeners = Object.create(null);
  const miniWindow = root;
  miniWindow.addEventListener = (type, fn) => {
    (listeners[type] ||= []).push(fn);
  };
  miniWindow.removeEventListener = (type, fn) => {
    if (!listeners[type]) return;
    listeners[type] = listeners[type].filter((f) => f !== fn);
  };
  miniWindow.dispatchEvent = (event) => {
    for (const fn of listeners[event.type] || []) fn(event);
    return true;
  };
  root.document = miniDocument;
  root.window = miniWindow;
  if (typeof root.navigator === "undefined") {
    root.navigator = { userAgent: "BrowC/Node", platform: "node" };
  }
  if (typeof root.localStorage === "undefined") {
    const store = new Map();
    root.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(String(k), String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  }
  if (typeof root.getComputedStyle === "undefined") {
    root.getComputedStyle = (el) => el.style || {};
  }

  /*
   * Fire DOMContentLoaded on the next microtask/tick once the rest of the
   * module (which registers the real listener at the bottom of this file)
   * has finished loading, so headless `node`/`import()` usage behaves like
   * a browser that has just finished parsing the document.
   */
  const scheduleReady =
    typeof queueMicrotask === "function"
      ? queueMicrotask
      : (fn) => setTimeout(fn, 0);
  scheduleReady(() => {
    scheduleReady(() => {
      miniWindow.dispatchEvent({ type: "DOMContentLoaded" });
    });
  });
})(typeof globalThis !== "undefined" ? globalThis : this);

/* ============================================================================
 * BrowC defensive runtime helpers
 * ============================================================================
 * These checks are intentionally small and dependency-free. They do not change
 * the C semantics; they reject malformed host-side values before they become
 * obscure JavaScript exceptions.
 * ========================================================================== */
const __BROWC_SAFETY__ = Object.freeze({
  isObject(value) {
    return (
      value !== null &&
      (typeof value === "object" || typeof value === "function")
    );
  },

  requireString(value, name = "value") {
    if (typeof value !== "string") {
      throw new TypeError(`${name} must be a string`);
    }
    return value;
  },

  requireFiniteNumber(value, name = "value") {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new RangeError(`${name} must be a finite number`);
    }
    return n;
  },

  requireInteger(value, name = "value") {
    const n = Number(value);
    if (!Number.isInteger(n)) {
      throw new RangeError(`${name} must be an integer`);
    }
    return n;
  },

  requireNonNegativeInteger(value, name = "value") {
    const n = this.requireInteger(value, name);
    if (n < 0) {
      throw new RangeError(`${name} must be non-negative`);
    }
    return n;
  },

  safeArrayIndex(index, length, name = "index") {
    const i = this.requireInteger(index, name);
    if (i < 0 || i >= length) {
      throw new RangeError(`${name} ${i} is outside [0, ${length})`);
    }
    return i;
  },

  checkedLength(value, name = "length") {
    const n = this.requireNonNegativeInteger(value, name);
    // JS array/string lengths are bounded by MAX_SAFE_INTEGER, while BrowC
    // pointers/memory are expected to use practical 32-bit-ish sizes.
    if (n > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`${name} is too large`);
    }
    return n;
  },
});

function __browcAssert(condition, message) {
  if (!condition) {
    throw new Error(`BrowC safety check failed: ${message}`);
  }
}

/* ================================================================
 * Diagnostics
 * ================================================================ */
class BrowCPreprocessorError extends Error {
  constructor(message, source = "<stdin>", line = 1, column = 1) {
    super(`${source}:${line}:${column}: error: ${message}`);
    this.name = "BrowCPreprocessorError";
    this.messageText = message;
    this.source = source;
    this.line = line;
    this.column = column;
  }
}
class BrowCPreprocessorWarning {
  constructor(message, source, line, column = 1) {
    this.message = `${source}:${line}:${column}: warning: ${message}`;
    this.source = source;
    this.line = line;
    this.column = column;
  }
}
/* ================================================================
 * Source location
 * ================================================================ */
class BrowCSourceLocation {
  constructor(source, line, column, offset = 0) {
    this.source = source;
    this.line = line;
    this.column = column;
    this.offset = offset;
  }
  clone() {
    return new BrowCSourceLocation(
      this.source,
      this.line,
      this.column,
      this.offset
    );
  }
}
/* ================================================================
 * Preprocessing token
 * ================================================================ */
class BrowCPPToken {
  constructor(kind, value, location = null, leadingSpace = false) {
    this.kind = kind;
    this.value = value;
    this.location = location;
    this.leadingSpace = leadingSpace;
  }
  clone() {
    return new BrowCPPToken(
      this.kind,
      this.value,
      this.location ? this.location.clone() : null,
      this.leadingSpace
    );
  }
  toString() {
    return this.value;
  }
}
const PPTokenKind = Object.freeze({
  IDENTIFIER: "identifier",
  NUMBER: "number",
  STRING: "string",
  CHARACTER: "character",
  HEADER_NAME: "header-name",
  PUNCTUATOR: "punctuator",
  WHITESPACE: "whitespace",
  OTHER: "other",
  END: "end",
});
/* ================================================================
 * Lexer
 *
 * Produces C preprocessing tokens.
 * ================================================================ */
class BrowCPPTokenizer {
  constructor(source, filename = "<stdin>", startLine = 1) {
    this.source = source;
    this.filename = filename;
    this.pos = 0;
    this.line = startLine;
    this.column = 1;
    this.tokens = [];
  }
  location() {
    return new BrowCSourceLocation(
      this.filename,
      this.line,
      this.column,
      this.pos
    );
  }
  advanceChar() {
    const c = this.source[this.pos++];
    if (c === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return c;
  }
  peek(n = 0) {
    return this.source[this.pos + n];
  }
  eof() {
    return this.pos >= this.source.length;
  }
  isIdentifierStart(c) {
    return !!c && /[A-Za-z_]/.test(c);
  }
  isIdentifierPart(c) {
    return !!c && /[A-Za-z0-9_]/.test(c);
  }
  isDigit(c) {
    return !!c && /[0-9]/.test(c);
  }
  isHexDigit(c) {
    return !!c && /[0-9A-Fa-f]/.test(c);
  }
  isWhitespace(c) {
    return (
      c === " " ||
      c === "\t" ||
      c === "\v" ||
      c === "\f" ||
      c === "\r" ||
      c === "\n"
    );
  }
  consumeWhitespace() {
    const loc = this.location();
    let text = "";
    while (!this.eof() && this.isWhitespace(this.peek())) {
      text += this.advanceChar();
    }
    return new BrowCPPToken(PPTokenKind.WHITESPACE, text, loc);
  }
  consumeIdentifier() {
    const loc = this.location();
    let text = "";
    text += this.advanceChar();
    while (!this.eof() && this.isIdentifierPart(this.peek())) {
      text += this.advanceChar();
    }
    return new BrowCPPToken(PPTokenKind.IDENTIFIER, text, loc);
  }
  consumeNumber() {
    const loc = this.location();
    let text = "";
    /*
     * C preprocessing numbers are deliberately broader than
     * ordinary decimal integers.
     */
    while (!this.eof()) {
      const c = this.peek();
      if (
        /[A-Za-z0-9_.]/.test(c) ||
        ((c === "+" || c === "-") &&
          (text.endsWith("e") ||
            text.endsWith("E") ||
            text.endsWith("p") ||
            text.endsWith("P")))
      ) {
        text += this.advanceChar();
      } else {
        break;
      }
    }
    return new BrowCPPToken(PPTokenKind.NUMBER, text, loc);
  }
  consumeQuoted(kind) {
    const loc = this.location();
    const quote = this.advanceChar();
    let text = quote;
    while (!this.eof()) {
      const c = this.advanceChar();
      text += c;
      if (c === "\\") {
        if (!this.eof()) {
          text += this.advanceChar();
        }
        continue;
      }
      if (c === quote) {
        break;
      }
    }
    return new BrowCPPToken(kind, text, loc);
  }
  consumePunctuator() {
    const loc = this.location();
    const operators = [
      ">>=",
      "<<=",
      "...",
      "->*",
      "++",
      "--",
      "->",
      "&&",
      "||",
      "<=",
      ">=",
      "==",
      "!=",
      "+=",
      "-=",
      "*=",
      "/=",
      "%=",
      "&=",
      "|=",
      "^=",
      "<<",
      ">>",
      "##",
      "::",
      ".*",
    ];
    for (const op of operators) {
      if (this.source.startsWith(op, this.pos)) {
        for (let i = 0; i < op.length; i++) {
          this.advanceChar();
        }
        return new BrowCPPToken(PPTokenKind.PUNCTUATOR, op, loc);
      }
    }
    const c = this.advanceChar();
    return new BrowCPPToken(PPTokenKind.PUNCTUATOR, c, loc);
  }
  tokenize() {
    let sawWhitespace = false;
    while (!this.eof()) {
      const c = this.peek();
      if (this.isWhitespace(c)) {
        const ws = this.consumeWhitespace();
        /*
         * Preserve the fact that whitespace occurred.
         * Actual whitespace tokens are removed later.
         */
        sawWhitespace = true;
        if (ws.value.includes("\n")) {
          /*
           * Newlines matter to directives, but this tokenizer
           * can preserve them as whitespace tokens.
           */
          this.tokens.push(ws);
          sawWhitespace = false;
        }
        continue;
      }
      let token;
      if (this.isIdentifierStart(c)) {
        token = this.consumeIdentifier();
      } else if (this.isDigit(c) || (c === "." && this.isDigit(this.peek(1)))) {
        token = this.consumeNumber();
      } else if (c === '"') {
        token = this.consumeQuoted(PPTokenKind.STRING);
      } else if (c === "'") {
        token = this.consumeQuoted(PPTokenKind.CHARACTER);
      } else {
        token = this.consumePunctuator();
      }
      token.leadingSpace = sawWhitespace;
      sawWhitespace = false;
      this.tokens.push(token);
    }
    this.tokens.push(new BrowCPPToken(PPTokenKind.END, "", this.location()));
    return this.tokens;
  }
}
/* ================================================================
 * Comment removal + line splicing
 * ================================================================ */
function browcRemoveCommentsAndSplice(source) {
  /*
   * Phase 1: backslash-newline splicing.
   */
  source = source.replace(/\\\r\n/g, "");
  source = source.replace(/\\\n/g, "");
  let out = "";
  let i = 0;
  let inString = false;
  let inCharacter = false;
  let escaped = false;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (inString) {
      out += c;
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    if (inCharacter) {
      out += c;
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === "'") {
        inCharacter = false;
      }
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === "'") {
      inCharacter = true;
      out += c;
      i++;
      continue;
    }
    /*
     * // comment
     */
    if (c === "/" && n === "/") {
      out += " ";
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        i++;
      }
      continue;
    }
    /*
     * /* comment *\/
     */
    if (c === "/" && n === "*") {
      out += " ";
      i += 2;
      while (i < source.length) {
        if (source[i] === "*" && source[i + 1] === "/") {
          i += 2;
          break;
        }
        if (source[i] === "\n") {
          out += "\n";
        } else {
          out += " ";
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
/* ================================================================
 * Macro representation
 * ================================================================ */
class BrowCMacro {
  constructor(name, options = {}) {
    this.name = name;
    this.functionLike = !!options.functionLike;
    this.parameters = options.parameters || [];
    this.variadic = !!options.variadic;
    this.replacement = options.replacement || [];
    this.builtin = !!options.builtin;
    this.disabled = false;
  }
  clone() {
    return new BrowCMacro(this.name, {
      functionLike: this.functionLike,
      parameters: [...this.parameters],
      variadic: this.variadic,
      replacement: this.replacement.map((t) => t.clone()),
      builtin: this.builtin,
    });
  }
}
/* ================================================================
 * Conditional compilation state
 * ================================================================ */
class BrowCConditionalFrame {
  constructor(outerActive, condition) {
    this.outerActive = outerActive;
    this.branchTaken = !!condition;
    this.active = outerActive && !!condition;
    this.elseSeen = false;
  }
}
/* ================================================================
 * BrowC standard library
 *
 * The user can replace/extend this object.
 * ================================================================ */
class BrowCStandardLibrary {
  constructor(headers = {}) {
    this.headers = new Map();
    for (const [name, body] of Object.entries(headers)) {
      this.set(name, body);
    }
  }
  normalize(name) {
    name = String(name).trim();
    if (!name.endsWith(".h")) {
      name += ".h";
    }
    return name;
  }
  set(name, source) {
    this.headers.set(this.normalize(name), String(source));
  }
  has(name) {
    return this.headers.has(this.normalize(name));
  }
  get(name) {
    return this.headers.get(this.normalize(name)) ?? null;
  }
  names() {
    return [...this.headers.keys()];
  }
}
/* ================================================================
 * IndexedDB standard-library adapter
 *
 * The preprocessor itself remains synchronous.
 *
 * IndexedDB access is therefore exposed as an asynchronous
 * preload mechanism.
 * ================================================================ */
class BrowCIndexedDBLibrary {
  constructor(options = {}) {
    this.dbName = options.dbName || "BrowC";
    this.storeName = options.storeName || "standard_library";
    this.db = null;
  }
  async open() {
    if (typeof indexedDB === "undefined") {
      throw new Error("IndexedDB is unavailable");
    }
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this;
  }
  async get(filename) {
    if (!this.db) {
      await this.open();
    }
    return await new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(filename);
      request.onsuccess = () => {
        resolve(request.result === undefined ? null : request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }
  async set(filename, source) {
    if (!this.db) {
      await this.open();
    }
    return await new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).put(String(source), filename);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
/* ================================================================
 * Main preprocessor
 * ================================================================ */
class BrowCPreprocessor {
  constructor(options = {}) {
    this.options = options;
    this.defaultFilename = options.filename || "<stdin>";
    this.standardLibrary =
      options.standardLibrary instanceof BrowCStandardLibrary
        ? options.standardLibrary
        : new BrowCStandardLibrary(options.standardLibrary || {});
    /*
     * IndexedDB can be preloaded into standardLibrary.
     */
    this.indexedDB = options.indexedDB || null;
    this.macros = new Map();
    this.includeStack = [];
    this.dependencies = [];
    this.warnings = [];
    this.pragmas = [];
    this.platform = options.platform || this.detectPlatform();
    this.architecture = options.architecture || this.detectArchitecture();
    this.target = options.target || this.platform;
    this.version = options.version || "1.0.0";
    this.date = options.date || this.makeDateMacro();
    this.time = options.time || this.makeTimeMacro();
    this.installBuiltinMacros();
  }
  /* ============================================================
   * Platform detection
   * ============================================================ */
  detectPlatform() {
    if (typeof navigator === "undefined") {
      return "unknown";
    }
    const p = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
    if (p.includes("windows")) {
      return "windows";
    }
    if (
      p.includes("macintosh") ||
      p.includes("mac os") ||
      p.includes("darwin")
    ) {
      return "macos";
    }
    if (p.includes("linux")) {
      return "linux";
    }
    if (p.includes("android")) {
      return "android";
    }
    if (p.includes("iphone") || p.includes("ipad") || p.includes("ios")) {
      return "ios";
    }
    return "unknown";
  }
  detectArchitecture() {
    if (typeof navigator === "undefined") {
      return "unknown";
    }
    const p = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
    if (
      p.includes("x86_64") ||
      p.includes("win64") ||
      p.includes("amd64") ||
      p.includes("x64")
    ) {
      return "x86_64";
    }
    if (p.includes("aarch64") || p.includes("arm64")) {
      return "aarch64";
    }
    if (p.includes("arm")) {
      return "arm";
    }
    if (p.includes("i686") || p.includes("x86")) {
      return "i386";
    }
    return "unknown";
  }
  /* ============================================================
   * Built-in macros
   * ============================================================ */
  installBuiltinMacros() {
    this.defineBuiltin("__STDC__", "1");
    this.defineBuiltin("__STDC_VERSION__", "199901L");
    /*
     * BrowC is hosted inside the browser runtime.
     */
    this.defineBuiltin("__STDC_HOSTED__", "1");
    this.defineBuiltin("__BROWC__", "1");
    const versionParts = this.version
      .split(".")
      .map((x) => parseInt(x, 10) || 0);
    this.defineBuiltin(
      "__BROWC_VERSION__",
      `${versionParts[0]}${versionParts[1]}${versionParts[2]}`
    );
    this.defineBuiltin("__BROWC_VERSION_MAJOR__", String(versionParts[0]));
    this.defineBuiltin("__BROWC_VERSION_MINOR__", String(versionParts[1]));
    this.defineBuiltin("__BROWC_VERSION_PATCH__", String(versionParts[2]));
    this.defineBuiltin("__DATE__", `"${this.date}"`);
    this.defineBuiltin("__TIME__", `"${this.time}"`);
    /*
     * Target operating system.
     *
     * These represent the selected BrowC compilation target,
     * not necessarily the host OS running the browser.
     */
    this.installTargetMacros(this.target);
    this.installArchitectureMacros(this.architecture);
  }
  defineBuiltin(name, value) {
    const tokenizer = new BrowCPPTokenizer(String(value), "<builtin>");
    const tokens = tokenizer
      .tokenize()
      .filter(
        (t) => t.kind !== PPTokenKind.END && t.kind !== PPTokenKind.WHITESPACE
      );
    this.macros.set(
      name,
      new BrowCMacro(name, {
        replacement: tokens,
        builtin: true,
      })
    );
  }
  undefBuiltin(name) {
    this.macros.delete(name);
  }
  installTargetMacros(target) {
    switch (String(target).toLowerCase()) {
      case "windows":
      case "win32":
        this.defineBuiltin("_WIN32", "1");
        this.defineBuiltin("__WIN32__", "1");
        this.defineBuiltin("_WIN64", "1");
        this.defineBuiltin("__WIN64__", "1");
        this.defineBuiltin("__WINDOWS__", "1");
        break;
      case "linux":
        this.defineBuiltin("__linux__", "1");
        this.defineBuiltin("__linux", "1");
        this.defineBuiltin("__unix__", "1");
        this.defineBuiltin("__unix", "1");
        break;
      case "macos":
      case "darwin":
        this.defineBuiltin("__APPLE__", "1");
        this.defineBuiltin("__MACH__", "1");
        this.defineBuiltin("__unix__", "1");
        this.defineBuiltin("__unix", "1");
        break;
      case "ios":
        this.defineBuiltin("__APPLE__", "1");
        this.defineBuiltin("__MACH__", "1");
        this.defineBuiltin("__IOS__", "1");
        break;
      case "android":
        this.defineBuiltin("__ANDROID__", "1");
        this.defineBuiltin("__linux__", "1");
        break;
    }
  }
  installArchitectureMacros(arch) {
    switch (String(arch).toLowerCase()) {
      case "x86_64":
      case "amd64":
        this.defineBuiltin("__x86_64__", "1");
        this.defineBuiltin("__amd64__", "1");
        this.defineBuiltin("_LP64", "1");
        break;
      case "i386":
      case "x86":
        this.defineBuiltin("__i386__", "1");
        break;
      case "aarch64":
      case "arm64":
        this.defineBuiltin("__aarch64__", "1");
        this.defineBuiltin("__arm64__", "1");
        this.defineBuiltin("_LP64", "1");
        break;
      case "arm":
        this.defineBuiltin("__arm__", "1");
        break;
    }
  }
  makeDateMacro() {
    const d = new Date();
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  }
  makeTimeMacro() {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
  }
  /* ============================================================
   * Public preprocessing entry point
   * ============================================================ */
  preprocess(source, filename = this.defaultFilename) {
    if (this.includeStack.includes(filename)) {
      throw new BrowCPreprocessorError(
        `recursive inclusion of '${filename}'`,
        filename,
        1,
        1
      );
    }
    this.includeStack.push(filename);
    try {
      const cleaned = browcRemoveCommentsAndSplice(String(source));
      const lines = cleaned.split(/\n/);
      const output = [];
      const conditionals = [];
      for (let i = 0; i < lines.length; i++) {
        const lineNumber = i + 1;
        const line = lines[i];
        const directive = this.getDirective(line);
        if (directive) {
          this.processDirective(
            directive,
            filename,
            lineNumber,
            conditionals,
            output
          );
          continue;
        }
        if (!this.isActive(conditionals)) {
          continue;
        }
        /*
         * Ordinary source line.
         */
        const tokens = this.tokenizeLine(line, filename, lineNumber);
        const expanded = this.expandTokens(tokens, {
          source: filename,
          line: lineNumber,
          disabled: new Set(),
        });
        output.push(this.tokensToSource(expanded));
      }
      if (conditionals.length !== 0) {
        throw new BrowCPreprocessorError(
          "unterminated conditional directive",
          filename,
          lines.length || 1,
          1
        );
      }
      return output.join("\n");
    } finally {
      this.includeStack.pop();
    }
  }
  /* ============================================================
   * Directive detection
   * ============================================================ */
  getDirective(line) {
    /*
     * Whitespace before # is allowed.
     */
    const match = line.match(
      /^[ \t]*#([A-Za-z_][A-Za-z0-9_]*)?(?:[ \t]*(.*))?$/
    );
    if (!match) {
      return null;
    }
    return {
      name: match[1] || "",
      text: match[2] || "",
    };
  }
  /* ============================================================
   * Conditional state
   * ============================================================ */
  isActive(stack) {
    if (stack.length === 0) {
      return true;
    }
    return stack[stack.length - 1].active;
  }
  parentActive(stack) {
    if (stack.length <= 1) {
      return true;
    }
    return stack[stack.length - 2].active;
  }
  /* ============================================================
   * Directives
   * ============================================================ */
  processDirective(directive, filename, lineNumber, conditionals, output) {
    const name = directive.name;
    const text = directive.text;
    switch (name) {
      case "if":
        this.directiveIf(text, filename, lineNumber, conditionals);
        return;
      case "ifdef":
        this.directiveIfdef(text, false, filename, lineNumber, conditionals);
        return;
      case "ifndef":
        this.directiveIfdef(text, true, filename, lineNumber, conditionals);
        return;
      case "elif":
        this.directiveElif(text, filename, lineNumber, conditionals);
        return;
      case "else":
        this.directiveElse(filename, lineNumber, conditionals);
        return;
      case "endif":
        this.directiveEndif(filename, lineNumber, conditionals);
        return;
    }
    /*
     * Everything below here is ignored in inactive branches.
     */
    if (!this.isActive(conditionals)) {
      return;
    }
    switch (name) {
      case "define":
        this.directiveDefine(text, filename, lineNumber);
        break;
      case "undef":
        this.directiveUndef(text, filename, lineNumber);
        break;
      case "include":
        this.directiveInclude(text, filename, lineNumber, output);
        break;
      case "error":
        throw new BrowCPreprocessorError(text.trim(), filename, lineNumber, 1);
      case "warning":
        this.warnings.push(
          new BrowCPreprocessorWarning(text.trim(), filename, lineNumber)
        );
        if (this.options.onWarning) {
          this.options.onWarning(this.warnings[this.warnings.length - 1]);
        }
        break;
      case "pragma":
        this.pragmas.push({
          filename,
          line: lineNumber,
          text,
        });
        if (this.options.onPragma) {
          this.options.onPragma(text, filename, lineNumber);
        }
        break;
      case "line":
        /*
         * #line is recorded for source mapping.
         */
        if (!this.options.ignoreLineDirectives) {
          output.push(`/* BrowC #line ${text.trim()} */`);
        }
        break;
      case "":
        /*
         * Empty preprocessor directive.
         */
        break;
      default:
        if (this.options.strictUnknownDirectives) {
          throw new BrowCPreprocessorError(
            `unknown preprocessing directive '#${name}'`,
            filename,
            lineNumber
          );
        }
        /*
         * Unknown directives are retained as diagnostics/comments
         * rather than silently becoming executable C.
         */
        output.push(`/* BrowC: ignored #${name} */`);
        break;
    }
  }
  /* ============================================================
   * #if
   * ============================================================ */
  directiveIf(expression, filename, lineNumber, stack) {
    const outerActive = this.isActive(stack);
    /*
     * Even when the outer branch is inactive, the expression
     * must not have side effects. It is still parsed enough
     * to preserve nested conditional structure.
     */
    let condition = false;
    if (outerActive) {
      condition = this.evaluateIfExpression(expression, filename, lineNumber);
    }
    stack.push(new BrowCConditionalFrame(outerActive, condition));
  }
  directiveIfdef(text, inverted, filename, lineNumber, stack) {
    const tokens = this.tokenizeLine(text, filename, lineNumber);
    const meaningful = tokens.filter((t) => t.kind !== PPTokenKind.WHITESPACE);
    if (
      meaningful.length !== 1 ||
      meaningful[0].kind !== PPTokenKind.IDENTIFIER
    ) {
      throw new BrowCPreprocessorError(
        `expected identifier after #${inverted ? "ifndef" : "ifdef"}`,
        filename,
        lineNumber
      );
    }
    const exists = this.macros.has(meaningful[0].value);
    const condition = inverted ? !exists : exists;
    const outerActive = this.isActive(stack);
    stack.push(
      new BrowCConditionalFrame(outerActive, outerActive && condition)
    );
  }
  directiveElif(expression, filename, lineNumber, stack) {
    if (stack.length === 0) {
      throw new BrowCPreprocessorError(
        "#elif without #if",
        filename,
        lineNumber
      );
    }
    const frame = stack[stack.length - 1];
    if (frame.elseSeen) {
      throw new BrowCPreprocessorError(
        "#elif after #else",
        filename,
        lineNumber
      );
    }
    if (!frame.outerActive) {
      frame.active = false;
      return;
    }
    if (frame.branchTaken) {
      frame.active = false;
      return;
    }
    const condition = this.evaluateIfExpression(
      expression,
      filename,
      lineNumber
    );
    frame.active = condition;
    if (condition) {
      frame.branchTaken = true;
    }
  }
  directiveElse(filename, lineNumber, stack) {
    if (stack.length === 0) {
      throw new BrowCPreprocessorError(
        "#else without #if",
        filename,
        lineNumber
      );
    }
    const frame = stack[stack.length - 1];
    if (frame.elseSeen) {
      throw new BrowCPreprocessorError(
        "multiple #else directives",
        filename,
        lineNumber
      );
    }
    frame.elseSeen = true;
    frame.active = frame.outerActive && !frame.branchTaken;
    frame.branchTaken = true;
  }
  directiveEndif(filename, lineNumber, stack) {
    if (stack.length === 0) {
      throw new BrowCPreprocessorError(
        "#endif without #if",
        filename,
        lineNumber
      );
    }
    stack.pop();
  }
  /* ============================================================
   * #define
   * ============================================================ */
  directiveDefine(text, filename, lineNumber) {
    const tokenizer = new BrowCPPTokenizer(text, filename, lineNumber);
    const tokens = tokenizer
      .tokenize()
      .filter(
        (t) => t.kind !== PPTokenKind.END && t.kind !== PPTokenKind.WHITESPACE
      );
    if (tokens.length === 0) {
      throw new BrowCPreprocessorError(
        "macro name missing",
        filename,
        lineNumber
      );
    }
    const nameToken = tokens[0];
    if (nameToken.kind !== PPTokenKind.IDENTIFIER) {
      throw new BrowCPreprocessorError(
        "macro name must be an identifier",
        filename,
        lineNumber
      );
    }
    const name = nameToken.value;
    let index = 1;
    let functionLike = false;
    let parameters = [];
    let variadic = false;
    /*
     * Function-like macro requires '(' immediately after name.
     * leadingSpace is therefore significant.
     */
    if (
      index < tokens.length &&
      tokens[index].value === "(" &&
      !tokens[index].leadingSpace
    ) {
      functionLike = true;
      index++;
      if (index < tokens.length && tokens[index].value === ")") {
        index++;
      } else {
        while (index < tokens.length) {
          const token = tokens[index];
          if (token.value === "...") {
            variadic = true;
            index++;
            if (index >= tokens.length || tokens[index].value !== ")") {
              throw new BrowCPreprocessorError(
                "expected ')' after '...'",
                filename,
                lineNumber
              );
            }
            index++;
            break;
          }
          if (token.kind !== PPTokenKind.IDENTIFIER) {
            throw new BrowCPreprocessorError(
              "expected macro parameter",
              filename,
              lineNumber
            );
          }
          parameters.push(token.value);
          index++;
          if (index < tokens.length && tokens[index].value === ",") {
            index++;
            continue;
          }
          if (index < tokens.length && tokens[index].value === ")") {
            index++;
            break;
          }
          throw new BrowCPreprocessorError(
            "expected ',' or ')' in macro parameter list",
            filename,
            lineNumber
          );
        }
      }
    }
    const replacement = tokens.slice(index);
    this.macros.set(
      name,
      new BrowCMacro(name, {
        functionLike,
        parameters,
        variadic,
        replacement,
      })
    );
  }
  /* ============================================================
   * #undef
   * ============================================================ */
  directiveUndef(text, filename, lineNumber) {
    const tokens = this.tokenizeLine(text, filename, lineNumber).filter(
      (t) => t.kind !== PPTokenKind.WHITESPACE
    );
    if (tokens.length !== 1 || tokens[0].kind !== PPTokenKind.IDENTIFIER) {
      throw new BrowCPreprocessorError(
        "expected macro name after #undef",
        filename,
        lineNumber
      );
    }
    this.macros.delete(tokens[0].value);
  }
  /* ============================================================
   * Include handling
   * ============================================================ */
  directiveInclude(text, filename, lineNumber, output) {
    const argument = text.trim();
    /*
     * #include <filename.h>
     */
    if (argument.startsWith("<") && argument.endsWith(">")) {
      const header = argument.slice(1, -1).trim();
      if (!header) {
        throw new BrowCPreprocessorError(
          "empty header name",
          filename,
          lineNumber
        );
      }
      const result = this.resolveStandardHeader(header, filename, lineNumber);
      output.push(this.preprocess(result.source, result.filename));
      return;
    }
    /*
     * #include "filename.h"
     */
    if (argument.startsWith('"') && argument.endsWith('"')) {
      const header = this.decodeHeaderString(argument.slice(1, -1));
      const result = this.resolveQuotedHeader(header, filename, lineNumber);
      output.push(this.preprocess(result.source, result.filename));
      return;
    }
    throw new BrowCPreprocessorError(
      'expected "FILENAME" or <FILENAME> after #include',
      filename,
      lineNumber
    );
  }
  decodeHeaderString(value) {
    return value.replace(/\\(.)/g, "$1");
  }
  /* ============================================================
   * <...> standard-library resolution
   * ============================================================ */
  resolveStandardHeader(header, includingFile, lineNumber) {
    const normalized = this.standardLibrary.normalize(header);
    const source = this.standardLibrary.get(normalized);
    if (source !== null) {
      this.dependencies.push({
        from: includingFile,
        to: normalized,
        kind: "standard",
      });
      return {
        source,
        filename: `<${normalized}>`,
      };
    }
    throw new BrowCPreprocessorError(
      `'${header}' file not found`,
      includingFile,
      lineNumber,
      1
    );
  }
  /* ============================================================
   * "..." resolution
   *
   * FIRST:
   *     every text/x-c script with matching filename
   *
   * THEN:
   *     standard library
   * ============================================================ */
  resolveQuotedHeader(header, includingFile, lineNumber) {
    const script = this.findScriptHeader(header);
    if (script !== null) {
      this.dependencies.push({
        from: includingFile,
        to: header,
        kind: "script",
      });
      return {
        source: script.source,
        filename: header,
      };
    }
    /*
     * User explicitly requested standard-library fallback.
     */
    const normalized = this.standardLibrary.normalize(header);
    const standardSource = this.standardLibrary.get(normalized);
    if (standardSource !== null) {
      this.dependencies.push({
        from: includingFile,
        to: normalized,
        kind: "standard-fallback",
      });
      return {
        source: standardSource,
        filename: `<${normalized}>`,
      };
    }
    throw new BrowCPreprocessorError(
      `'${header}' file not found`,
      includingFile,
      lineNumber,
      1
    );
  }
  /* ============================================================
   * Search ALL text/x-c scripts.
   *
   * filename attribute is authoritative.
   * ============================================================ */
  findScriptHeader(filename) {
    if (
      typeof document === "undefined" ||
      typeof document.querySelectorAll !== "function"
    ) {
      return null;
    }
    const scripts = document.querySelectorAll('script[type="text/x-c"]');
    for (const script of scripts) {
      const declaredFilename = script.getAttribute("filename");
      if (declaredFilename === filename) {
        return {
          source: script.textContent || "",
          filename,
        };
      }
    }
    return null;
  }
  /* ============================================================
   * Tokenization helper
   * ============================================================ */
  tokenizeLine(source, filename, lineNumber) {
    return new BrowCPPTokenizer(source, filename, lineNumber)
      .tokenize()
      .filter(
        (t) => t.kind !== PPTokenKind.END && t.kind !== PPTokenKind.WHITESPACE
      );
  }
  /* ============================================================
   * Macro expansion
   * ============================================================ */
  expandTokens(tokens, context = {}) {
    const result = [];
    const disabled = context.disabled || new Set();
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.kind !== PPTokenKind.IDENTIFIER) {
        result.push(token.clone());
        continue;
      }
      /*
       * Builtin dynamic macros.
       */
      if (token.value === "__FILE__") {
        const fileToken = new BrowCPPToken(
          PPTokenKind.STRING,
          JSON.stringify(
            context.source || token.location?.source || this.defaultFilename
          ),
          token.location
        );
        result.push(fileToken);
        continue;
      }
      if (token.value === "__LINE__") {
        result.push(
          new BrowCPPToken(
            PPTokenKind.NUMBER,
            String(context.line || token.location?.line || 1),
            token.location
          )
        );
        continue;
      }
      const macro = this.macros.get(token.value);
      if (!macro) {
        result.push(token.clone());
        continue;
      }
      /*
       * C macro recursion suppression.
       */
      if (disabled.has(macro.name) || macro.disabled) {
        result.push(token.clone());
        continue;
      }
      /*
       * Function-like macro requires following '('.
       */
      if (macro.functionLike) {
        if (i + 1 >= tokens.length || tokens[i + 1].value !== "(") {
          result.push(token.clone());
          continue;
        }
        const invocation = this.collectMacroArguments(tokens, i + 1);
        if (!invocation) {
          result.push(token.clone());
          continue;
        }
        const replacement = this.expandFunctionMacro(
          macro,
          invocation.arguments,
          context,
          disabled
        );
        result.push(...replacement);
        i = invocation.endIndex;
        continue;
      }
      /*
       * Object-like macro.
       */
      const nextDisabled = new Set(disabled);
      nextDisabled.add(macro.name);
      const replacement = macro.replacement.map((t) => t.clone());
      const expanded = this.expandTokens(replacement, {
        ...context,
        disabled: nextDisabled,
      });
      result.push(...expanded);
    }
    return result;
  }
  /* ============================================================
   * Function macro argument collection
   * ============================================================ */
  collectMacroArguments(tokens, openIndex) {
    if (tokens[openIndex]?.value !== "(") {
      return null;
    }
    const args = [];
    let current = [];
    let depth = 0;
    for (let i = openIndex; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.value === "(") {
        depth++;
        if (depth > 1) {
          current.push(token.clone());
        }
        continue;
      }
      if (token.value === ")") {
        depth--;
        if (depth === 0) {
          /*
           * Empty argument list.
           */
          if (args.length === 0 && current.length === 0) {
            return {
              arguments: [],
              endIndex: i,
            };
          }
          args.push(current);
          return {
            arguments: args,
            endIndex: i,
          };
        }
        current.push(token.clone());
        continue;
      }
      if (token.value === "," && depth === 1) {
        args.push(current);
        current = [];
        continue;
      }
      current.push(token.clone());
    }
    return null;
  }
  /* ============================================================
   * Function-like macro expansion
   * ============================================================ */
  expandFunctionMacro(macro, rawArguments, context, disabled) {
    const argumentMap = new Map();
    /*
     * Map ordinary parameters.
     */
    for (let i = 0; i < macro.parameters.length; i++) {
      const name = macro.parameters[i];
      const raw = rawArguments[i] || [];
      const expanded = this.expandTokens(raw, {
        ...context,
        disabled: new Set(disabled),
      });
      argumentMap.set(name, {
        raw,
        expanded,
      });
    }
    /*
     * Variadic arguments.
     */
    if (macro.variadic) {
      const first = macro.parameters.length;
      const variadicRaw = rawArguments.slice(first);
      const variadicExpanded = [];
      for (let i = 0; i < variadicRaw.length; i++) {
        if (i !== 0) {
          variadicExpanded.push(new BrowCPPToken(PPTokenKind.PUNCTUATOR, ","));
        }
        variadicExpanded.push(
          ...this.expandTokens(variadicRaw[i], {
            ...context,
            disabled: new Set(disabled),
          })
        );
      }
      argumentMap.set("__VA_ARGS__", {
        raw: variadicRaw.flat(),
        expanded: variadicExpanded,
      });
    }
    /*
     * Substitute # and ## correctly.
     */
    const substituted = [];
    const replacement = macro.replacement;
    for (let i = 0; i < replacement.length; i++) {
      const token = replacement[i];
      /*
       * Stringification.
       */
      if (token.value === "#" && i + 1 < replacement.length) {
        const next = replacement[i + 1];
        if (
          next.kind === PPTokenKind.IDENTIFIER &&
          argumentMap.has(next.value)
        ) {
          const arg = argumentMap.get(next.value);
          substituted.push(
            new BrowCPPToken(
              PPTokenKind.STRING,
              this.stringifyTokens(arg.raw),
              token.location
            )
          );
          i++;
          continue;
        }
      }
      /*
       * Token pasting.
       */
      if (token.value === "##") {
        if (substituted.length === 0 || i + 1 >= replacement.length) {
          throw new BrowCPreprocessorError(
            "invalid ## operator in macro replacement",
            token.location?.source || context.source || "<stdin>",
            token.location?.line || context.line || 1,
            token.location?.column || 1
          );
        }
        const left = substituted.pop();
        const right = replacement[++i];
        const rightTokens = this.argumentReplacement(right, argumentMap);
        if (rightTokens.length === 0) {
          continue;
        }
        const rightFirst = rightTokens[0];
        const pasted = this.relexPastedToken(
          left.value + rightFirst.value,
          token.location
        );
        substituted.push(pasted);
        /*
         * Any remaining right-side tokens are retained.
         */
        substituted.push(...rightTokens.slice(1));
        continue;
      }
      substituted.push(...this.argumentReplacement(token, argumentMap));
    }
    /*
     * Rescan.
     */
    const nextDisabled = new Set(disabled);
    nextDisabled.add(macro.name);
    return this.expandTokens(substituted, {
      ...context,
      disabled: nextDisabled,
    });
  }
  argumentReplacement(token, argumentMap) {
    if (token.kind === PPTokenKind.IDENTIFIER && argumentMap.has(token.value)) {
      /*
       * Normal macro argument substitution uses the
       * already-expanded argument.
       */
      return argumentMap.get(token.value).expanded.map((t) => t.clone());
    }
    return [token.clone()];
  }
  stringifyTokens(tokens) {
    let result = "";
    let previousSpace = false;
    for (const token of tokens) {
      if (token.leadingSpace) {
        previousSpace = true;
      }
      if (previousSpace && result.length > 0) {
        result += " ";
      }
      result += token.value;
      previousSpace = false;
    }
    /*
     * Escape as a C string literal.
     */
    return `"${result
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")}"`;
  }
  relexPastedToken(value, location) {
    const tokens = new BrowCPPTokenizer(
      value,
      location?.source || "<macro>",
      location?.line || 1
    )
      .tokenize()
      .filter(
        (t) => t.kind !== PPTokenKind.END && t.kind !== PPTokenKind.WHITESPACE
      );
    if (tokens.length !== 1) {
      return new BrowCPPToken(PPTokenKind.OTHER, value, location);
    }
    return tokens[0];
  }
  /* ============================================================
   * #if expression evaluation
   * ============================================================ */
  evaluateIfExpression(expression, filename, lineNumber) {
    let tokens = this.tokenizeLine(expression, filename, lineNumber);
    /*
     * defined MACRO
     *
     * defined(MACRO)
     */
    const replaced = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.kind === PPTokenKind.IDENTIFIER && token.value === "defined") {
        if (tokens[i + 1]?.value === "(") {
          const name = tokens[i + 2];
          if (
            !name ||
            name.kind !== PPTokenKind.IDENTIFIER ||
            tokens[i + 3]?.value !== ")"
          ) {
            throw new BrowCPreprocessorError(
              "invalid defined expression",
              filename,
              lineNumber
            );
          }
          replaced.push(this.numberToken(this.macros.has(name.value) ? 1 : 0));
          i += 3;
          continue;
        }
        const name = tokens[i + 1];
        if (!name || name.kind !== PPTokenKind.IDENTIFIER) {
          throw new BrowCPreprocessorError(
            "expected identifier after defined",
            filename,
            lineNumber
          );
        }
        replaced.push(this.numberToken(this.macros.has(name.value) ? 1 : 0));
        i++;
        continue;
      }
      replaced.push(token);
    }
    /*
     * Expand macros.
     */
    tokens = this.expandTokens(replaced, {
      source: filename,
      line: lineNumber,
      disabled: new Set(),
    });
    /*
     * Any remaining identifiers become 0 in #if expressions.
     */
    tokens = tokens.map((token) => {
      if (token.kind === PPTokenKind.IDENTIFIER) {
        return this.numberToken(0);
      }
      return token;
    });
    const parser = new BrowCConstantExpressionParser(
      tokens,
      filename,
      lineNumber
    );
    const value = parser.parse();
    return value !== 0n;
  }
  numberToken(value) {
    return new BrowCPPToken(PPTokenKind.NUMBER, String(value));
  }
  /* ============================================================
   * Token output
   * ============================================================ */
  tokensToSource(tokens) {
    let output = "";
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (i !== 0) {
        const previous = tokens[i - 1];
        if (this.needsSpace(previous, token)) {
          output += " ";
        }
      }
      output += token.value;
    }
    return output;
  }
  needsSpace(a, b) {
    if (
      a.kind === PPTokenKind.IDENTIFIER &&
      (b.kind === PPTokenKind.IDENTIFIER || b.kind === PPTokenKind.NUMBER)
    ) {
      return true;
    }
    if (
      a.kind === PPTokenKind.NUMBER &&
      (b.kind === PPTokenKind.IDENTIFIER || b.kind === PPTokenKind.NUMBER)
    ) {
      return true;
    }
    /*
     * Prevent accidental formation of another operator.
     */
    const combined = a.value + b.value;
    const dangerous = [
      "++",
      "--",
      "->",
      "&&",
      "||",
      "<<",
      ">>",
      "<=",
      ">=",
      "==",
      "!=",
      "+=",
      "-=",
      "*=",
      "/=",
      "%=",
      "&=",
      "|=",
      "^=",
      "##",
    ];
    return dangerous.includes(combined);
  }
}
/* ================================================================
 * C integer constant expression parser
 *
 * Uses BigInt so that #if expressions don't suffer from the
 * browser's floating-point Number limitations.
 * ================================================================ */
class BrowCConstantExpressionParser {
  constructor(tokens, filename, line) {
    this.tokens = tokens;
    this.filename = filename;
    this.line = line;
    this.pos = 0;
  }
  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }
  match(value) {
    if (this.peek()?.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }
  expect(value) {
    if (!this.match(value)) {
      throw new BrowCPreprocessorError(
        `expected '${value}'`,
        this.filename,
        this.line
      );
    }
  }
  parse() {
    const value = this.parseLogicalOr();
    if (this.pos < this.tokens.length) {
      throw new BrowCPreprocessorError(
        `unexpected token '${this.peek().value}' in #if expression`,
        this.filename,
        this.line
      );
    }
    return value;
  }
  parseLogicalOr() {
    let left = this.parseLogicalAnd();
    while (this.match("||")) {
      const right = this.parseLogicalAnd();
      left = left !== 0n || right !== 0n ? 1n : 0n;
    }
    return left;
  }
  parseLogicalAnd() {
    let left = this.parseBitwiseOr();
    while (this.match("&&")) {
      const right = this.parseBitwiseOr();
      left = left !== 0n && right !== 0n ? 1n : 0n;
    }
    return left;
  }
  parseBitwiseOr() {
    let left = this.parseBitwiseXor();
    while (this.match("|")) {
      left |= this.parseBitwiseXor();
    }
    return left;
  }
  parseBitwiseXor() {
    let left = this.parseBitwiseAnd();
    while (this.match("^")) {
      left ^= this.parseBitwiseAnd();
    }
    return left;
  }
  parseBitwiseAnd() {
    let left = this.parseEquality();
    while (this.match("&")) {
      left &= this.parseEquality();
    }
    return left;
  }
  parseEquality() {
    let left = this.parseRelational();
    while (true) {
      if (this.match("==")) {
        const right = this.parseRelational();
        left = left === right ? 1n : 0n;
        continue;
      }
      if (this.match("!=")) {
        const right = this.parseRelational();
        left = left !== right ? 1n : 0n;
        continue;
      }
      break;
    }
    return left;
  }
  parseRelational() {
    let left = this.parseShift();
    while (true) {
      if (this.match("<")) {
        const right = this.parseShift();
        left = left < right ? 1n : 0n;
        continue;
      }
      if (this.match(">")) {
        const right = this.parseShift();
        left = left > right ? 1n : 0n;
        continue;
      }
      if (this.match("<=")) {
        const right = this.parseShift();
        left = left <= right ? 1n : 0n;
        continue;
      }
      if (this.match(">=")) {
        const right = this.parseShift();
        left = left >= right ? 1n : 0n;
        continue;
      }
      break;
    }
    return left;
  }
  parseShift() {
    let left = this.parseAdditive();
    while (true) {
      if (this.match("<<")) {
        const right = this.parseAdditive();
        left <<= right;
        continue;
      }
      if (this.match(">>")) {
        const right = this.parseAdditive();
        left >>= right;
        continue;
      }
      break;
    }
    return left;
  }
  parseAdditive() {
    let left = this.parseMultiplicative();
    while (true) {
      if (this.match("+")) {
        left += this.parseMultiplicative();
        continue;
      }
      if (this.match("-")) {
        left -= this.parseMultiplicative();
        continue;
      }
      break;
    }
    return left;
  }
  parseMultiplicative() {
    let left = this.parseUnary();
    while (true) {
      if (this.match("*")) {
        left *= this.parseUnary();
        continue;
      }
      if (this.match("/")) {
        const right = this.parseUnary();
        if (right === 0n) {
          throw new BrowCPreprocessorError(
            "division by zero in #if expression",
            this.filename,
            this.line
          );
        }
        left /= right;
        continue;
      }
      if (this.match("%")) {
        const right = this.parseUnary();
        if (right === 0n) {
          throw new BrowCPreprocessorError(
            "division by zero in #if expression",
            this.filename,
            this.line
          );
        }
        left %= right;
        continue;
      }
      break;
    }
    return left;
  }
  parseUnary() {
    if (this.match("!")) {
      return this.parseUnary() === 0n ? 1n : 0n;
    }
    if (this.match("~")) {
      return ~this.parseUnary();
    }
    if (this.match("+")) {
      return +this.parseUnary();
    }
    if (this.match("-")) {
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }
  parsePrimary() {
    if (this.match("(")) {
      const value = this.parseLogicalOr();
      this.expect(")");
      return value;
    }
    const token = this.peek();
    if (!token) {
      throw new BrowCPreprocessorError(
        "expected expression",
        this.filename,
        this.line
      );
    }
    if (token.kind === PPTokenKind.NUMBER) {
      this.pos++;
      return this.parseIntegerLiteral(token.value);
    }
    if (token.kind === PPTokenKind.CHARACTER) {
      this.pos++;
      return this.parseCharacterLiteral(token.value);
    }
    throw new BrowCPreprocessorError(
      `invalid token '${token.value}' in #if expression`,
      this.filename,
      this.line
    );
  }
  parseIntegerLiteral(text) {
    let s = text;
    /*
     * Remove integer suffixes.
     */
    s = s.replace(/[uUlL]+$/g, "");
    if (/^0[xX][0-9A-Fa-f]+$/.test(s)) {
      return BigInt(s);
    }
    if (/^0[bB][01]+$/.test(s)) {
      return BigInt(s);
    }
    if (/^0[0-7]*$/.test(s)) {
      return BigInt(s || "0");
    }
    if (/^[0-9]+$/.test(s)) {
      return BigInt(s);
    }
    /*
     * Floating constants aren't valid integer constant
     * expressions for ordinary #if usage.
     */
    throw new BrowCPreprocessorError(
      `invalid integer constant '${text}'`,
      this.filename,
      this.line
    );
  }
  parseCharacterLiteral(text) {
    /*
     * Basic C character constants.
     * Full multicharacter/wide character semantics belong
     * to the compiler's lexer.
     */
    if (text.length < 3) {
      throw new BrowCPreprocessorError(
        `invalid character constant '${text}'`,
        this.filename,
        this.line
      );
    }
    const body = text.slice(1, -1);
    if (body.length === 1) {
      return BigInt(body.charCodeAt(0));
    }
    if (body.startsWith("\\")) {
      switch (body) {
        case "\\n":
          return 10n;
        case "\\r":
          return 13n;
        case "\\t":
          return 9n;
        case "\\0":
          return 0n;
        case "\\\\":
          return 92n;
        case "\\'":
          return 39n;
        case '\\"':
          return 34n;
      }
    }
    return BigInt(body.charCodeAt(0));
  }
}
/* ================================================================
 * Standard-library convenience API
 * ================================================================ */
function createBrowCStandardLibrary(headers = {}) {
  return new BrowCStandardLibrary(headers);
}
/* ================================================================
 * Browser/global exports
 * ================================================================ */
if (typeof globalThis !== "undefined") {
  globalThis.BrowCPreprocessor = BrowCPreprocessor;
  globalThis.BrowCPreprocessorError = BrowCPreprocessorError;
  globalThis.BrowCStandardLibrary = BrowCStandardLibrary;
  globalThis.BrowCIndexedDBLibrary = BrowCIndexedDBLibrary;
  globalThis.BrowCPPToken = BrowCPPToken;
  globalThis.BrowCPPTokenKind = PPTokenKind;
  globalThis.createBrowCStandardLibrary = createBrowCStandardLibrary;
}
/* ================================================================
 * Node.js exports
 * ================================================================ */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BrowCPreprocessor,
    BrowCPreprocessorError,
    BrowCStandardLibrary,
    BrowCIndexedDBLibrary,
    BrowCPPToken,
    PPTokenKind,
    createBrowCStandardLibrary,
  };
}
/*
 * browc-lexer.js
 *
 * BrowC C99 Lexer
 *
 * Input:
 *     preprocessed BrowC source
 *
 * Output:
 *     Token[]
 *
 * Designed to sit between:
 *
 *     BrowCPreprocessor -> BrowCLexer -> BrowCParser
 *
 * BrowC extensions:
 *
 *     dom
 *     __js__
 *
 * The lexer does NOT execute JavaScript, manipulate the DOM,
 * access IndexedDB, or perform semantic analysis.
 *
 * Those belong to later compiler/runtime phases.
 */
("use strict");
/* ============================================================
 * Errors
 * ============================================================ */
class BrowCLexError extends Error {
  constructor(message, filename, line, column, sourceLine = null) {
    let text = `${filename}:${line}:${column}: error: ${message}`;
    if (sourceLine !== null) {
      text += `\n${sourceLine}`;
      text += `\n${" ".repeat(Math.max(0, column - 1))}^`;
    }
    super(text);
    this.name = "BrowCLexError";
    this.filename = filename;
    this.line = line;
    this.column = column;
    this.sourceLine = sourceLine;
  }
}
/* ============================================================
 * Token kinds
 * ============================================================ */
const TokenKind = Object.freeze({
  /* End */
  EOF: "eof",
  /* Identifiers */
  IDENTIFIER: "identifier",
  /* Literals */
  INTEGER_CONSTANT: "integer_constant",
  FLOAT_CONSTANT: "float_constant",
  CHARACTER_CONSTANT: "character_constant",
  STRING_LITERAL: "string_literal",
  /* C keywords */
  AUTO: "auto",
  BREAK: "break",
  CASE: "case",
  CHAR: "char",
  CONST: "const",
  CONTINUE: "continue",
  DEFAULT: "default",
  DO: "do",
  DOUBLE: "double",
  ELSE: "else",
  ENUM: "enum",
  EXTERN: "extern",
  FLOAT: "float",
  FOR: "for",
  GOTO: "goto",
  IF: "if",
  INLINE: "inline",
  INT: "int",
  LONG: "long",
  REGISTER: "register",
  RESTRICT: "restrict",
  RETURN: "return",
  SHORT: "short",
  SIGNED: "signed",
  SIZEOF: "sizeof",
  STATIC: "static",
  STRUCT: "struct",
  SWITCH: "switch",
  TYPEDEF: "typedef",
  UNION: "union",
  UNSIGNED: "unsigned",
  VOID: "void",
  VOLATILE: "volatile",
  WHILE: "while",
  _BOOL: "_Bool",
  _COMPLEX: "_Complex",
  _IMAGINARY: "_Imaginary",
  /* C99/C11/C23-ish standard keywords useful to BrowC */
  ALIGNAS: "_Alignas",
  ALIGNOF: "_Alignof",
  ATOMIC: "_Atomic",
  GENERIC: "_Generic",
  NORETURN: "_Noreturn",
  STATIC_ASSERT: "_Static_assert",
  THREAD_LOCAL: "_Thread_local",
  /* BrowC */
  DOM: "dom",
  JS: "__js__",
  /* Punctuation */
  LBRACE: "{",
  RBRACE: "}",
  LBRACKET: "[",
  RBRACKET: "]",
  LPAREN: "(",
  RPAREN: ")",
  COMMA: ",",
  SEMICOLON: ";",
  COLON: ":",
  QUESTION: "?",
  DOT: ".",
  ELLIPSIS: "...",
  /* Operators */
  PLUS: "+",
  MINUS: "-",
  STAR: "*",
  SLASH: "/",
  PERCENT: "%",
  INC: "++",
  DEC: "--",
  AMPERSAND: "&",
  PIPE: "|",
  CARET: "^",
  TILDE: "~",
  BANG: "!",
  ASSIGN: "=",
  PLUS_ASSIGN: "+=",
  MINUS_ASSIGN: "-=",
  STAR_ASSIGN: "*=",
  SLASH_ASSIGN: "/=",
  PERCENT_ASSIGN: "%=",
  AMPERSAND_ASSIGN: "&=",
  PIPE_ASSIGN: "|=",
  CARET_ASSIGN: "^=",
  LEFT_SHIFT: "<<",
  RIGHT_SHIFT: ">>",
  LEFT_SHIFT_ASSIGN: "<<=",
  RIGHT_SHIFT_ASSIGN: ">>=",
  EQUAL: "==",
  NOT_EQUAL: "!=",
  LESS: "<",
  GREATER: ">",
  LESS_EQUAL: "<=",
  GREATER_EQUAL: ">=",
  LOGICAL_AND: "&&",
  LOGICAL_OR: "||",
  ARROW: "->",
  HASH: "#",
  HASH_HASH: "##",
  /* GNU/MSVC/common extensions */
  DOUBLE_COLON: "::",
  AT: "@",
  /* Preprocessor leftovers */
  PP_DIRECTIVE: "pp_directive",
});
/* ============================================================
 * Keyword table
 * ============================================================ */
const KEYWORDS = new Map([
  ["auto", TokenKind.AUTO],
  ["break", TokenKind.BREAK],
  ["case", TokenKind.CASE],
  ["char", TokenKind.CHAR],
  ["const", TokenKind.CONST],
  ["continue", TokenKind.CONTINUE],
  ["default", TokenKind.DEFAULT],
  ["do", TokenKind.DO],
  ["double", TokenKind.DOUBLE],
  ["else", TokenKind.ELSE],
  ["enum", TokenKind.ENUM],
  ["extern", TokenKind.EXTERN],
  ["float", TokenKind.FLOAT],
  ["for", TokenKind.FOR],
  ["goto", TokenKind.GOTO],
  ["if", TokenKind.IF],
  ["inline", TokenKind.INLINE],
  ["int", TokenKind.INT],
  ["long", TokenKind.LONG],
  ["register", TokenKind.REGISTER],
  ["restrict", TokenKind.RESTRICT],
  ["return", TokenKind.RETURN],
  ["short", TokenKind.SHORT],
  ["signed", TokenKind.SIGNED],
  ["sizeof", TokenKind.SIZEOF],
  ["static", TokenKind.STATIC],
  ["struct", TokenKind.STRUCT],
  ["switch", TokenKind.SWITCH],
  ["typedef", TokenKind.TYPEDEF],
  ["union", TokenKind.UNION],
  ["unsigned", TokenKind.UNSIGNED],
  ["void", TokenKind.VOID],
  ["volatile", TokenKind.VOLATILE],
  ["while", TokenKind.WHILE],
  ["_Bool", TokenKind._BOOL],
  ["_Complex", TokenKind._COMPLEX],
  ["_Imaginary", TokenKind._IMAGINARY],
  ["_Alignas", TokenKind.ALIGNAS],
  ["_Alignof", TokenKind.ALIGNOF],
  ["_Atomic", TokenKind.ATOMIC],
  ["_Generic", TokenKind.GENERIC],
  ["_Noreturn", TokenKind.NORETURN],
  ["_Static_assert", TokenKind.STATIC_ASSERT],
  ["_Thread_local", TokenKind.THREAD_LOCAL],
  /*
   * BrowC language extensions.
   */
  ["dom", TokenKind.DOM],
  ["__js__", TokenKind.JS],
]);
/* ============================================================
 * Punctuator table
 *
 * Longest operators MUST be checked first.
 * ============================================================ */
const PUNCTUATORS = [
  ["%:%:", TokenKind.HASH_HASH],
  ["<<=", TokenKind.LEFT_SHIFT_ASSIGN],
  [">>=", TokenKind.RIGHT_SHIFT_ASSIGN],
  ["...", TokenKind.ELLIPSIS],
  ["++", TokenKind.INC],
  ["--", TokenKind.DEC],
  ["->", TokenKind.ARROW],
  ["<<", TokenKind.LEFT_SHIFT],
  [">>", TokenKind.RIGHT_SHIFT],
  ["<=", TokenKind.LESS_EQUAL],
  [">=", TokenKind.GREATER_EQUAL],
  ["==", TokenKind.EQUAL],
  ["!=", TokenKind.NOT_EQUAL],
  ["&&", TokenKind.LOGICAL_AND],
  ["||", TokenKind.LOGICAL_OR],
  ["+=", TokenKind.PLUS_ASSIGN],
  ["-=", TokenKind.MINUS_ASSIGN],
  ["*=", TokenKind.STAR_ASSIGN],
  ["/=", TokenKind.SLASH_ASSIGN],
  ["%=", TokenKind.PERCENT_ASSIGN],
  ["&=", TokenKind.AMPERSAND_ASSIGN],
  ["|=", TokenKind.PIPE_ASSIGN],
  ["^=", TokenKind.CARET_ASSIGN],
  ["##", TokenKind.HASH_HASH],
  ["::", TokenKind.DOUBLE_COLON],
  ["{", TokenKind.LBRACE],
  ["}", TokenKind.RBRACE],
  ["[", TokenKind.LBRACKET],
  ["]", TokenKind.RBRACKET],
  ["(", TokenKind.LPAREN],
  [")", TokenKind.RPAREN],
  [",", TokenKind.COMMA],
  [";", TokenKind.SEMICOLON],
  [":", TokenKind.COLON],
  ["?", TokenKind.QUESTION],
  [".", TokenKind.DOT],
  ["+", TokenKind.PLUS],
  ["-", TokenKind.MINUS],
  ["*", TokenKind.STAR],
  ["/", TokenKind.SLASH],
  ["%", TokenKind.PERCENT],
  ["&", TokenKind.AMPERSAND],
  ["|", TokenKind.PIPE],
  ["^", TokenKind.CARET],
  ["~", TokenKind.TILDE],
  ["!", TokenKind.BANG],
  ["=", TokenKind.ASSIGN],
  ["<", TokenKind.LESS],
  [">", TokenKind.GREATER],
  ["#", TokenKind.HASH],
  ["@", TokenKind.AT],
];
/* ============================================================
 * Token object
 * ============================================================ */
class BrowCToken {
  constructor(
    kind,
    value,
    raw,
    filename,
    line,
    column,
    endLine,
    endColumn,
    offset,
    endOffset
  ) {
    this.kind = kind;
    this.value = value;
    this.raw = raw;
    this.filename = filename;
    this.line = line;
    this.column = column;
    this.endLine = endLine;
    this.endColumn = endColumn;
    this.offset = offset;
    this.endOffset = endOffset;
  }
  toString() {
    return `${this.kind}(${JSON.stringify(this.value)})`;
  }
}
/* ============================================================
 * Lexer
 * ============================================================ */
class BrowCLexer {
  constructor(source, filename = "<stdin>", options = {}) {
    this.originalSource = String(source ?? "");
    this.filename = filename;
    this.options = {
      keepComments: options.keepComments === true,
      keepWhitespace: options.keepWhitespace === true,
      keepNewlines: options.keepNewlines === true,
      allowBinary: options.allowBinary !== false,
      allowDollarIdentifiers: options.allowDollarIdentifiers === true,
      allowUnicodeIdentifiers: options.allowUnicodeIdentifiers !== false,
      allowGNU: options.allowGNU !== false,
      allowMSVC: options.allowMSVC !== false,
      processTrigraphs: options.processTrigraphs !== false,
      processLineSplicing: options.processLineSplicing !== false,
    };
    this.source = this.prepareSource(this.originalSource);
    this.length = this.source.length;
    this.index = 0;
    this.line = 1;
    this.column = 1;
    this.lineStartOffset = 0;
    this.tokens = [];
    this.lastToken = null;
  }
  /* ========================================================
   * Source preprocessing
   * ======================================================== */
  prepareSource(source) {
    let text = source;
    if (this.options.processTrigraphs) {
      text = this.replaceTrigraphs(text);
    }
    if (this.options.processLineSplicing) {
      text = this.removeLineSplices(text);
    }
    return text;
  }
  replaceTrigraphs(text) {
    const trigraphs = new Map([
      ["??=", "#"],
      ["??/", "\\"],
      ["??'", "^"],
      ["??(", "["],
      ["??)", "]"],
      ["??!", "|"],
      ["??<", "{"],
      ["??>", "}"],
      ["??-", "~"],
    ]);
    return text.replace(
      /\?\?[=\/'()!<>-]/g,
      (match) => trigraphs.get(match) ?? match
    );
  }
  removeLineSplices(text) {
    /*
     * C translation phase:
     *
     * backslash immediately followed by newline
     * becomes nothing.
     */
    return text
      .replace(/\\\r\n/g, "")
      .replace(/\\\n/g, "")
      .replace(/\\\r/g, "");
  }
  /* ========================================================
   * Character access
   * ======================================================== */
  current() {
    if (this.index >= this.length) {
      return "\0";
    }
    return this.source[this.index];
  }
  peek(offset = 1) {
    const position = this.index + offset;
    if (position >= this.length) {
      return "\0";
    }
    return this.source[position];
  }
  advance() {
    const ch = this.current();
    if (ch === "\0") {
      return ch;
    }
    this.index++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
      this.lineStartOffset = this.index;
    } else {
      this.column++;
    }
    return ch;
  }
  match(text) {
    return this.source.startsWith(text, this.index);
  }
  consume(text) {
    if (!this.match(text)) {
      return false;
    }
    for (let i = 0; i < text.length; i++) {
      this.advance();
    }
    return true;
  }
  /* ========================================================
   * Character classes
   * ======================================================== */
  isWhitespace(ch) {
    return (
      ch === " " ||
      ch === "\t" ||
      ch === "\v" ||
      ch === "\f" ||
      ch === "\r" ||
      ch === "\n"
    );
  }
  isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }
  isHexDigit(ch) {
    return (
      (ch >= "0" && ch <= "9") ||
      (ch >= "a" && ch <= "f") ||
      (ch >= "A" && ch <= "F")
    );
  }
  isBinaryDigit(ch) {
    return ch === "0" || ch === "1";
  }
  isIdentifierStart(ch) {
    if (ch === "_" || this.isASCIIAlpha(ch)) {
      return true;
    }
    if (this.options.allowDollarIdentifiers && ch === "$") {
      return true;
    }
    /*
     * BrowC can permit Unicode identifiers.
     *
     * The C99 grammar itself is based around implementation
     * character sets, while modern BrowC can optionally support
     * Unicode identifiers.
     */
    if (this.options.allowUnicodeIdentifiers && ch !== "\0") {
      const code = ch.codePointAt(0);
      return code > 0x7f && !this.isWhitespace(ch) && !/[0-9]/.test(ch);
    }
    return false;
  }
  isIdentifierPart(ch) {
    return this.isIdentifierStart(ch) || this.isDigit(ch);
  }
  isASCIIAlpha(ch) {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
  }
  /* ========================================================
   * Position helpers
   * ======================================================== */
  makeToken(kind, value, startIndex, startLine, startColumn) {
    return new BrowCToken(
      kind,
      value,
      this.source.slice(startIndex, this.index),
      this.filename,
      startLine,
      startColumn,
      this.line,
      this.column,
      startIndex,
      this.index
    );
  }
  error(message, line = this.line, column = this.column) {
    const sourceLine = this.getSourceLine(line);
    throw new BrowCLexError(message, this.filename, line, column, sourceLine);
  }
  getSourceLine(line) {
    const lines = this.source.split(/\r?\n/);
    return lines[line - 1] ?? "";
  }
  /* ========================================================
   * Main lexer
   * ======================================================== */
  lex() {
    return this.tokenize();
  }

  tokenize() {
    this.tokens = [];
    while (true) {
      const token = this.nextToken();
      this.tokens.push(token);
      if (token.kind === TokenKind.EOF) {
        break;
      }
    }
    return this.tokens;
  }
  nextToken() {
    while (true) {
      if (this.index >= this.length) {
        return new BrowCToken(
          TokenKind.EOF,
          null,
          "",
          this.filename,
          this.line,
          this.column,
          this.line,
          this.column,
          this.index,
          this.index
        );
      }
      const ch = this.current();
      /* -----------------------------------------------
       * Whitespace
       * ----------------------------------------------- */
      if (this.isWhitespace(ch)) {
        const token = this.lexWhitespace();
        if (token === null) {
          continue;
        }
        return token;
      }
      /* -----------------------------------------------
       * Comments
       * ----------------------------------------------- */
      if (this.match("//")) {
        const token = this.lexLineComment();
        if (token === null) {
          continue;
        }
        return token;
      }
      if (this.match("/*")) {
        const token = this.lexBlockComment();
        if (token === null) {
          continue;
        }
        return token;
      }
      /* -----------------------------------------------
       * Preprocessor directives
       *
       * Normally these should already have been handled
       * by BrowCPreprocessor.
       *
       * Keeping this capability makes the lexer robust
       * when used independently.
       * ----------------------------------------------- */
      if (ch === "#") {
        if (this.isAtBeginningOfLogicalLine()) {
          return this.lexPPDirective();
        }
      }
      /* -----------------------------------------------
       * Identifier / keyword
       * ----------------------------------------------- */
      if (this.isIdentifierStart(ch)) {
        return this.lexIdentifierOrKeyword();
      }
      /* -----------------------------------------------
       * Numeric constants
       * ----------------------------------------------- */
      if (this.isDigit(ch) || (ch === "." && this.isDigit(this.peek()))) {
        return this.lexNumber();
      }
      /* -----------------------------------------------
       * Character constants
       * ----------------------------------------------- */
      if (
        ch === "'" ||
        this.match("L'") ||
        this.match("u'") ||
        this.match("U'") ||
        this.match("u8'")
      ) {
        return this.lexCharacterConstant();
      }

      // String literal
      if (char === '"') {
        const startLine = line;
        const startCol = col;
        let strVal = "";
        const startIdx = i;
        i++; // skip opening quote
        col++;

        while (i < src.length && src[i] !== '"') {
          if (src[i] === "\\") {
            strVal += src[i];
            i++;
            col++;
            if (i < src.length) {
              strVal += src[i];
              i++;
              col++;
            }
          } else {
            strVal += src[i];
            i++;
            col++;
          }
        }

        if (i < src.length) {
          i++; // skip closing quote
          col++;
        }

        const fullRaw = src.slice(startIdx, i);
        tokens.push(
          new BrowCParserToken(
            "STRING_LITERAL",
            strVal,
            startLine,
            startCol,
            this.filename,
            fullRaw
          )
        );
        continue;
      }

      // Character constant
      if (char === "'") {
        const startLine = line;
        const startCol = col;
        let charVal = "";
        const startIdx = i;
        i++; // skip opening quote
        col++;

        while (i < src.length && src[i] !== "'") {
          if (src[i] === "\\") {
            charVal += src[i];
            i++;
            col++;
            if (i < src.length) {
              charVal += src[i];
              i++;
              col++;
            }
          } else {
            charVal += src[i];
            i++;
            col++;
          }
        }

        if (i < src.length) {
          i++; // skip closing quote
          col++;
        }

        const fullRaw = src.slice(startIdx, i);
        tokens.push(
          new BrowCParserToken(
            "CHARACTER_CONSTANT",
            charVal,
            startLine,
            startCol,
            this.filename,
            fullRaw
          )
        );
        continue;
      }
    }
  }
  /* ========================================================
   * Whitespace
   * ======================================================== */
  lexWhitespace() {
    const start = this.index;
    const line = this.line;
    const column = this.column;
    while (this.isWhitespace(this.current())) {
      this.advance();
    }
    if (!this.options.keepWhitespace) {
      if (
        this.options.keepNewlines &&
        this.source.slice(start, this.index).includes("\n")
      ) {
        return this.makeToken("newline", "\n", start, line, column);
      }
      return null;
    }
    return this.makeToken(
      "whitespace",
      this.source.slice(start, this.index),
      start,
      line,
      column
    );
  }
  /* ========================================================
   * Comments
   * ======================================================== */
  lexLineComment() {
    const start = this.index;
    const line = this.line;
    const column = this.column;
    this.consume("//");
    while (
      this.current() !== "\n" &&
      this.current() !== "\r" &&
      this.current() !== "\0"
    ) {
      this.advance();
    }
    if (!this.options.keepComments) {
      return null;
    }
    return this.makeToken(
      "comment",
      this.source.slice(start, this.index),
      start,
      line,
      column
    );
  }
  lexBlockComment() {
    const start = this.index;
    const line = this.line;
    const column = this.column;
    this.consume("/*");
    while (!this.match("*/")) {
      if (this.current() === "\0") {
        this.error("unterminated comment", line, column);
      }
      this.advance();
    }
    this.consume("*/");
    if (!this.options.keepComments) {
      return null;
    }
    return this.makeToken(
      "comment",
      this.source.slice(start, this.index),
      start,
      line,
      column
    );
  }
  /* ========================================================
   * Identifier / keyword
   * ======================================================== */
  lexIdentifierOrKeyword() {
    const start = this.index;
    const line = this.line;
    const column = this.column;
    while (this.isIdentifierPart(this.current())) {
      this.advance();
    }
    const raw = this.source.slice(start, this.index);
    const kind = KEYWORDS.get(raw) || TokenKind.IDENTIFIER;
    return this.makeToken(kind, raw, start, line, column);
  }
  /* ========================================================
   * Numbers
   * ======================================================== */
  lexNumber() {
    const start = this.index;
    const line = this.line;
    const column = this.column;
    let isFloat = false;
    /*
     * Hexadecimal number.
     */
    if (
      this.current() === "0" &&
      (this.peek() === "x" || this.peek() === "X")
    ) {
      this.advance();
      this.advance();
      let digits = 0;
      while (this.isHexDigit(this.current())) {
        this.advance();
        digits++;
      }
      /*
       * Hex floating constant:
       *
       * 0x1.fp3
       * 0x1.0p-2
       */
      if (this.current() === ".") {
        isFloat = true;
        this.advance();
        while (this.isHexDigit(this.current())) {
          this.advance();
          digits++;
        }
      }
      if (this.current() === "p" || this.current() === "P") {
        isFloat = true;
        this.advance();
        if (this.current() === "+" || this.current() === "-") {
          this.advance();
        }
        if (!this.isDigit(this.current())) {
          this.error("expected hexadecimal floating exponent");
        }
        while (this.isDigit(this.current())) {
          this.advance();
        }
      }
      if (digits === 0) {
        this.error("invalid hexadecimal constant", line, column);
      }
      this.lexNumericSuffix();
      const raw = this.source.slice(start, this.index);
      return this.makeToken(
        isFloat ? TokenKind.FLOAT_CONSTANT : TokenKind.INTEGER_CONSTANT,
        this.parseNumericValue(raw, isFloat),
        start,
        line,
        column
      );
    }
    /*
     * Binary extension.
     */
    if (
      this.options.allowBinary &&
      this.current() === "0" &&
      (this.peek() === "b" || this.peek() === "B")
    ) {
      this.advance();
      this.advance();
      if (!this.isBinaryDigit(this.current())) {
        this.error("expected binary digit after 0b");
      }
      while (this.isBinaryDigit(this.current()) || this.current() === "'") {
        this.advance();
      }
      this.lexIntegerSuffix();
      const raw = this.source.slice(start, this.index);
      return this.makeToken(
        TokenKind.INTEGER_CONSTANT,
        this.parseNumericValue(raw, false),
        start,
        line,
        column
      );
    }
    /*
     * Decimal / octal / decimal floating.
     */
    if (this.current() === ".") {
      isFloat = true;
      this.advance();
      while (this.isDigit(this.current()) || this.current() === "'") {
        this.advance();
      }
    } else {
      while (this.isDigit(this.current()) || this.current() === "'") {
        this.advance();
      }
      if (this.current() === ".") {
        isFloat = true;
        this.advance();
        while (this.isDigit(this.current()) || this.current() === "'") {
          this.advance();
        }
      }
    }
    /*
     * Decimal exponent.
     */
    if (this.current() === "e" || this.current() === "E") {
      isFloat = true;
      this.advance();
      if (this.current() === "+" || this.current() === "-") {
        this.advance();
      }
      if (!this.isDigit(this.current())) {
        this.error("expected exponent digits");
      }
      while (this.isDigit(this.current())) {
        this.advance();
      }
    }
    /*
     * Floating suffix.
     */
    if (
      this.current() === "f" ||
      this.current() === "F" ||
      this.current() === "l" ||
      this.current() === "L"
    ) {
      isFloat = true;
      this.advance();
    }
    /*
     * Integer suffix.
     */
    if (!isFloat) {
      this.lexIntegerSuffix();
    }
    /*
     * C++ digit separators are not C99.
     *
     * We intentionally don't accept arbitrary apostrophes
     * as a separate token here except where consumed above.
     */
    const raw = this.source.slice(start, this.index);
    return this.makeToken(
      isFloat ? TokenKind.FLOAT_CONSTANT : TokenKind.INTEGER_CONSTANT,
      this.parseNumericValue(raw, isFloat),
      start,
      line,
      column
    );
  }
  lexIntegerSuffix() {
    /*
     * Valid forms include:
     *
     * u
     * U
     * l
     * L
     * ul
     * UL
     * lu
     * LU
     * ull
     * ULL
     * llu
     * LLU
     */
    let suffix = "";
    while (/[uUlL]/.test(this.current())) {
      suffix += this.advance();
      if (suffix.length > 3) {
        break;
      }
    }
    if (suffix.length > 3) {
      this.error("invalid integer suffix");
    }
    if (!/^(?:[uUlL]{0,3})$/.test(suffix)) {
      this.error("invalid integer suffix");
    }
  }
  lexNumericSuffix() {
    /*
     * Hex floating constants may have L/F.
     */
    if (
      this.current() === "f" ||
      this.current() === "F" ||
      this.current() === "l" ||
      this.current() === "L"
    ) {
      this.advance();
    }
  }
  parseNumericValue(raw, isFloat) {
    /*
     * Remove C digit separators if BrowC accepted them.
     */
    const cleaned = raw.replace(/'/g, "");
    if (isFloat) {
      const value = Number(cleaned);
      /*
       * JavaScript Number cannot directly parse every
       * hexadecimal floating constant.
       *
       * Preserve the literal for the parser/type system.
       */
      if (/0[xX]/.test(cleaned) && /[pP]/.test(cleaned)) {
        return cleaned;
      }
      return value;
    }
    /*
     * Keep large integer constants as strings when JS cannot
     * represent them exactly.
     */
    try {
      const lower = cleaned.toLowerCase();
      if (
        lower.endsWith("ull") ||
        lower.endsWith("llu") ||
        lower.endsWith("ll")
      ) {
        return BigInt(cleaned.replace(/[uUlL]+$/, ""));
      }
      const value = Number(cleaned);
      if (Number.isSafeInteger(value)) {
        return value;
      }
      return BigInt(cleaned.replace(/[uUlL]+$/, ""));
    } catch {
      return cleaned;
    }
  }
  /* ========================================================
   * Character constants
   * ======================================================== */
  lexCharacterConstant() {
    const start = this.index;
    const line = this.line;
    const column = this.column;
    let prefix = "";
    if (this.match("u8'")) {
      prefix = "u8";
      this.advance();
      this.advance();
      this.advance();
    } else if (this.match("L'") || this.match("u'") || this.match("U'")) {
      prefix = this.current();
      this.advance();
      this.advance();
    } else if (this.current() === "'") {
      this.advance();
    } else {
      this.error("invalid character constant");
    }
    let value = "";
    let count = 0;
    while (this.current() !== "'" && this.current() !== "\0") {
      if (this.current() === "\n" || this.current() === "\r") {
        this.error("newline in character constant", line, column);
      }
      if (this.current() === "\\") {
        value += this.readEscapeSequence();
      } else {
        value += this.advance();
      }
      count++;
    }
    if (this.current() !== "'") {
      this.error("unterminated character constant", line, column);
    }
    this.advance();
    if (count === 0) {
      this.error("empty character constant", line, column);
    }
    /*
     * C permits multicharacter constants as implementation-defined
     * integer values.
     *
     * We preserve the decoded content for semantic analysis.
     */
    return this.makeToken(
      TokenKind.CHARACTER_CONSTANT,
      {
        prefix,
        value,
      },
      start,
      line,
      column
    );
  }
  /* ========================================================
   * String literals
   * ======================================================== */
  lexStringLiteral() {
    const start = this.index;
    const line = this.line;
    const column = this.column;
    let prefix = "";
    if (this.match('u8"')) {
      prefix = "u8";
      this.advance();
      this.advance();
      this.advance();
    } else if (this.match('L"') || this.match('u"') || this.match('U"')) {
      prefix = this.current();
      this.advance();
      this.advance();
    } else if (this.current() === '"') {
      this.advance();
    } else {
      this.error("invalid string literal");
    }
    let value = "";
    while (this.current() !== '"' && this.current() !== "\0") {
      if (this.current() === "\n" || this.current() === "\r") {
        this.error("newline in string literal", line, column);
      }
      if (this.current() === "\\") {
        value += this.readEscapeSequence();
      } else {
        value += this.advance();
      }
    }
    if (this.current() !== '"') {
      this.error("unterminated string literal", line, column);
    }
    this.advance();
    return this.makeToken(
      TokenKind.STRING_LITERAL,
      {
        prefix,
        value,
      },
      start,
      line,
      column
    );
  }
  /* ========================================================
   * Escape sequences
   * ======================================================== */
  readEscapeSequence() {
    if (this.current() !== "\\") {
      return this.advance();
    }
    this.advance();
    const ch = this.current();
    /*
     * Simple escapes.
     */
    const simple = {
      a: "\x07",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
      "'": "'",
      '"': '"',
      "?": "?",
    };
    if (Object.prototype.hasOwnProperty.call(simple, ch)) {
      this.advance();
      return simple[ch];
    }
    /*
     * Octal escape:
     *
     * \0
     * \123
     */
    if (ch >= "0" && ch <= "7") {
      let digits = "";
      for (let i = 0; i < 3; i++) {
        const c = this.current();
        if (c >= "0" && c <= "7") {
          digits += this.advance();
        } else {
          break;
        }
      }
      return String.fromCodePoint(parseInt(digits, 8));
    }
    /*
     * Hex escape:
     *
     * \xFF
     */
    if (ch === "x") {
      this.advance();
      let digits = "";
      while (this.isHexDigit(this.current())) {
        digits += this.advance();
      }
      if (digits.length === 0) {
        this.error("expected hexadecimal digits after \\x");
      }
      return String.fromCodePoint(parseInt(digits, 16));
    }
    /*
     * Universal character names:
     *
     * \uXXXX
     * \UXXXXXXXX
     */
    if (ch === "u" || ch === "U") {
      const kind = this.advance();
      const count = kind === "u" ? 4 : 8;
      let digits = "";
      for (let i = 0; i < count; i++) {
        if (!this.isHexDigit(this.current())) {
          this.error(`invalid universal character name`);
        }
        digits += this.advance();
      }
      const codePoint = parseInt(digits, 16);
      if (
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        this.error("invalid Unicode code point");
      }
      return String.fromCodePoint(codePoint);
    }
    /*
     * Unknown escape.
     *
     * GCC/Clang warn for many of these rather than treating
     * them as fatal lexical errors. Preserve the escaped
     * character here so semantic/diagnostic layers can decide.
     */
    return this.advance();
  }
  /* ========================================================
   * Punctuators
   * ======================================================== */
  lexPunctuator() {
    const start = this.index;
    const line = this.line;
    const column = this.column;
    /*
     * Longest-match rule.
     */
    for (const [text, kind] of PUNCTUATORS) {
      if (this.match(text)) {
        this.consume(text);
        return this.makeToken(kind, text, start, line, column);
      }
    }
    this.error(`invalid character '${this.current()}'`, line, column);
  }
  /* ========================================================
   * Preprocessor directive
   *
   * Normally BrowCPreprocessor removes these.
   * ======================================================== */
  isAtBeginningOfLogicalLine() {
    let i = this.index - 1;
    while (i >= 0) {
      const ch = this.source[i];
      if (ch === "\n") {
        return true;
      }
      if (
        ch !== " " &&
        ch !== "\t" &&
        ch !== "\r" &&
        ch !== "\f" &&
        ch !== "\v"
      ) {
        return false;
      }
      i--;
    }
    return true;
  }
  lexPPDirective() {
    const start = this.index;
    const line = this.line;
    const column = this.column;
    while (this.current() !== "\n" && this.current() !== "\0") {
      this.advance();
    }
    const raw = this.source.slice(start, this.index);
    return this.makeToken(TokenKind.PP_DIRECTIVE, raw, start, line, column);
  }
  /* ========================================================
   * Parser helpers
   * ======================================================== */
  static is(token, kind) {
    return token && token.kind === kind;
  }
  static isIdentifier(token) {
    return token && token.kind === TokenKind.IDENTIFIER;
  }
  static isTypeKeyword(token) {
    if (!token) {
      return false;
    }
    return [
      TokenKind.VOID,
      TokenKind.CHAR,
      TokenKind.SHORT,
      TokenKind.INT,
      TokenKind.LONG,
      TokenKind.FLOAT,
      TokenKind.DOUBLE,
      TokenKind.SIGNED,
      TokenKind.UNSIGNED,
      TokenKind._BOOL,
      TokenKind._COMPLEX,
      TokenKind._IMAGINARY,
      TokenKind.DOM,
    ].includes(token.kind);
  }
}
/* ============================================================
 * Token stream
 *
 * This is what your parser should actually consume.
 * ============================================================ */
class BrowCTokenStream {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
  }
  peek(offset = 0) {
    const index = this.position + offset;
    if (index >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1];
    }
    return this.tokens[index];
  }
  next() {
    const token = this.peek();
    if (this.position < this.tokens.length - 1) {
      this.position++;
    }
    return token;
  }
  eof() {
    return this.peek().kind === TokenKind.EOF;
  }
  check(kind) {
    return this.peek().kind === kind;
  }
  match(kind) {
    if (this.check(kind)) {
      return this.next();
    }
    return null;
  }
  expect(kind, message = null) {
    const token = this.peek();
    if (token.kind !== kind) {
      throw new BrowCLexError(
        message || `expected '${kind}', got '${token.kind}'`,
        token.filename,
        token.line,
        token.column
      );
    }
    return this.next();
  }
  previous() {
    if (this.position === 0) {
      return this.tokens[0];
    }
    return this.tokens[this.position - 1];
  }
}
/* ============================================================
 * Complete BrowC lexical entry point
 * ============================================================ */
function lexBrowC(source, filename = "<stdin>", options = {}) {
  const lexer = new BrowCLexer(source, filename, options);
  const tokens = lexer.tokenize();
  return {
    tokens,
    stream: new BrowCTokenStream(tokens),
    source: lexer.source,
    filename,
  };
}
/* ============================================================
 * BrowC compiler pipeline
 *
 * This is the exact handoff from the preprocessor to lexer
 * to parser.
 * ============================================================ */
function preprocessAndLexBrowC(
  source,
  filename,
  preprocessorOptions = {},
  lexerOptions = {}
) {
  if (typeof BrowCPreprocessor === "undefined") {
    throw new Error("BrowCPreprocessor is not loaded");
  }
  const preprocessor = new BrowCPreprocessor({
    standardLibrary:
      typeof HEADERS !== "undefined" && !preprocessorOptions.standardLibrary
        ? HEADERS
        : preprocessorOptions.standardLibrary || {},
    ...preprocessorOptions,
    filename,
  });
  /*
   * Expected preprocessor result:
   *
   * {
   *     code: "...",
   *     sourceMap: [...]
   * }
   */
  const preprocessed = preprocessor.preprocess(source, filename);
  /*
   * Support the simpler preprocessor API too.
   */
  const code =
    typeof preprocessed === "string" ? preprocessed : preprocessed.code;
  const sourceMap =
    typeof preprocessed === "string" ? [] : preprocessed.sourceMap || [];
  const lexical = lexBrowC(code, filename, lexerOptions);
  return {
    code,
    sourceMap,
    tokens: lexical.tokens,
    stream: lexical.stream,
  };
}
/* ============================================================
 * Exports
 * ============================================================ */
if (typeof globalThis !== "undefined") {
  globalThis.BrowCTokenKind = TokenKind;
  globalThis.BrowCToken = BrowCToken;
  globalThis.BrowCLexError = BrowCLexError;
  globalThis.BrowCLexer = BrowCLexer;
  globalThis.BrowCTokenStream = BrowCTokenStream;
  globalThis.lexBrowC = lexBrowC;
  globalThis.preprocessAndLexBrowC = preprocessAndLexBrowC;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TokenKind,
    BrowCToken,
    BrowCLexError,
    BrowCLexer,
    BrowCTokenStream,
    lexBrowC,
    preprocessAndLexBrowC,
  };
}
/*
 * browc-parser.js
 *
 * BrowC
 * ----
 * C99 parser + BrowC __js__(...) extension.
 *
 * No standard library.
 * No WebAssembly.
 * No execution engine.
 *
 * Input:
 *
 *   int main(void)
 *   {
 *       int x = 10;
 *
 *       if (x > 5) {
 *           x++;
 *       }
 *
 *       __js__("console.log('hello from C')");
 *
 *       return x;
 *   }
 *
 * Output:
 *   An AST.
 *
 * Errors:
 *   GCC/Clang-style syntax/lexical diagnostics.
 *
 * Notes:
 *   - This is a syntactic parser.
 *   - C preprocessing is intentionally not expanded here.
 *   - Typedef-name tracking is implemented because C requires it
 *     to disambiguate declarations from expressions.
 *   - __js__(...) is a BrowC extension.
 */
("use strict");
/* ============================================================
 * ERROR
 * ============================================================
 */
class BrowCParseError extends Error {
  constructor(message, token, source) {
    const filename = token && token.filename ? token.filename : "<browc>";
    const line = token && token.line ? token.line : 1;
    const column = token && token.column ? token.column : 1;
    super(`${filename}:${line}:${column}: error: ${message}`);
    this.name = "BrowCParseError";
    this.messageText = message;
    this.filename = filename;
    this.line = line;
    this.column = column;
    this.token = token || null;
    this.source = source || "";
  }
}
/* ============================================================
 * TOKEN
 * ============================================================
 */
class BrowCParserToken {
  constructor(type, value, line, column, filename, raw = value) {
    this.type = type;
    this.value = value;
    this.raw = raw;
    this.line = line;
    this.column = column;
    this.filename = filename;
  }
}
/* ============================================================
 * PARSER
 * ============================================================
 */
class BrowCParser {
  /* --------------------------------------------------------
   * C99 keywords
   * --------------------------------------------------------
   */
  static KEYWORDS = new Set([
    "auto",
    "break",
    "case",
    "char",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extern",
    "float",
    "for",
    "goto",
    "if",
    "inline",
    "int",
    "long",
    "register",
    "restrict",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "struct",
    "switch",
    "typedef",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while",
    /* C99 special keywords */
    "_Bool",
    "_Complex",
    "_Imaginary",
  ]);
  /* C11 keywords are rejected as normal C99 identifiers here,
       but we retain them so they can be enabled later. */
  static EXTENDED_KEYWORDS = new Set([
    "_Alignas",
    "_Alignof",
    "_Atomic",
    "_Generic",
    "_Noreturn",
    "_Static_assert",
    "_Thread_local",
  ]);
  /* BrowC extension */
  static BROWC_KEYWORDS = new Set(["__js__", "__js__"]);
  static STORAGE_CLASS_SPECIFIERS = new Set([
    "typedef",
    "extern",
    "static",
    "auto",
    "register",
  ]);
  static TYPE_QUALIFIERS = new Set(["const", "restrict", "volatile"]);
  static FUNCTION_SPECIFIERS = new Set(["inline"]);
  static BASIC_TYPE_SPECIFIERS = new Set([
    "void",
    "char",
    "short",
    "int",
    "long",
    "float",
    "double",
    "signed",
    "unsigned",
    "_Bool",
    "_Complex",
    "_Imaginary",
  ]);
  static ASSIGNMENT_OPERATORS = new Set([
    "=",
    "*=",
    "/=",
    "%=",
    "+=",
    "-=",
    "<<=",
    ">>=",
    "&=",
    "^=",
    "|=",
  ]);
  static UNARY_OPERATORS = new Set(["++", "--", "&", "*", "+", "-", "~", "!"]);
  static PREFIX_OPERATORS = new Set(["++", "--", "&", "*", "+", "-", "~", "!"]);
  static BINARY_OPERATORS = new Set([
    "||",
    "&&",
    "|",
    "^",
    "&",
    "==",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
    "<<",
    ">>",
    "+",
    "-",
    "*",
    "/",
    "%",
  ]);
  static PREPROCESSOR_DIRECTIVES = new Set([
    "include",
    "define",
    "undef",
    "if",
    "ifdef",
    "ifndef",
    "elif",
    "else",
    "endif",
    "line",
    "error",
    "pragma",
  ]);
  static MULTI_CHAR_OPERATORS = [
    ">>=",
    "<<=",
    "...",
    "++",
    "--",
    "->",
    "<<",
    ">>",
    "<=",
    ">=",
    "==",
    "!=",
    "&&",
    "||",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "&=",
    "^=",
    "|=",
    "##",
  ];
  static PUNCTUATION = new Set([
    "{",
    "}",
    "[",
    "]",
    "(",
    ")",
    ";",
    ",",
    ":",
    "?",
    ".",
  ]);
  constructor(source, options = {}) {
    this.source = String(source);
    this.filename = options.filename || "<browc>";
    this.tokens = [];
    this.pos = 0;
    /*
     * C requires parser state to know whether an identifier
     * is a typedef-name.
     */
    this.scopes = [
      {
        ordinary: new Set(),
        typedefs: new Set(),
        tags: new Set(),
        labels: new Set(),
      },
    ];
    this.nodeId = 1;
  }
  /* ========================================================
   * PUBLIC
   * ========================================================
   */
  parse() {
    this.tokens = this.lex();
    this.pos = 0;
    const declarations = [];
    while (!this.at("EOF")) {
      if (this.atType("COMMENT")) {
        declarations.push(this.parseComment());
        continue;
      }
      if (this.atType("PP_DIRECTIVE")) {
        declarations.push(this.parsePreprocessorDirective());
        continue;
      }
      declarations.push(this.parseExternalDeclaration());
    }
    return this.node("TranslationUnit", {
      declarations,
    });
  }
  isDeclarationStart() {
    if (this.at("EOF")) {
      return false;
    }

    const tok = this.peek();
    const val = tok.value;

    // 1. Storage Class Specifiers (typedef, extern, static, auto, register)
    if (BrowCParser.STORAGE_CLASS_SPECIFIERS.has(val)) {
      return true;
    }

    // 2. Type Qualifiers (const, restrict, volatile)
    if (BrowCParser.TYPE_QUALIFIERS.has(val)) {
      return true;
    }

    // 3. Function Specifiers (inline)
    if (BrowCParser.FUNCTION_SPECIFIERS.has(val)) {
      return true;
    }

    // 4. Basic Built-in Types (void, int, char, float, double, etc.)
    if (BrowCParser.BASIC_TYPE_SPECIFIERS.has(val)) {
      return true;
    }

    // 5. Aggregate/Enum Specifiers (struct, union, enum)
    if (val === "struct" || val === "union" || val === "enum") {
      return true;
    }

    // 6. User-defined Typedef Names in Scope
    if (tok.type === "IDENTIFIER" || tok.type === "identifier") {
      return this.isTypedefName(val);
    }

    return false;
  }

  /**
   * Helper to check active scope stacks for typedef names.
   */
  isTypedefName(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].typedefs.has(name)) {
        return true;
      }
    }
    return false;
  }
  /* ========================================================
   * LEXER
   * ========================================================
   */

  pushScope() {
    this.scopes.push({
      ordinary: new Set(),
      typedefs: new Set(),
      tags: new Set(),
      labels: new Set(),
    });
  }

  popScope() {
    if (this.scopes.length > 1) {
      this.scopes.pop();
    }
  }

  currentScope() {
    return this.scopes[this.scopes.length - 1];
  }

  addTypedefName(name) {
    this.currentScope().typedefs.add(name);
  }

  addOrdinaryName(name) {
    this.currentScope().ordinary.add(name);
  }

  isTypedefName(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].typedefs.has(name)) {
        return true;
      }
      if (this.scopes[i].ordinary.has(name)) {
        return false;
      }
    }
    return false;
  }

  /* ========================================================
   * LEXER
   * ========================================================
   */
  lex() {
    const tokens = [];
    let line = 1;
    let col = 1;
    let i = 0;
    const src = this.source;

    while (i < src.length) {
      const char = src[i];

      // Newline handling
      if (char === "\n") {
        line++;
        col = 1;
        i++;
        continue;
      }

      // Whitespace
      if (/\s/.test(char)) {
        col++;
        i++;
        continue;
      }

      // Comments
      if (char === "/" && src[i + 1] === "/") {
        const startLine = line;
        const startCol = col;
        let commentText = "";
        i += 2;
        col += 2;
        while (i < src.length && src[i] !== "\n") {
          commentText += src[i];
          i++;
          col++;
        }
        tokens.push(
          new BrowCParserToken(
            "COMMENT",
            commentText,
            startLine,
            startCol,
            this.filename,
            `//${commentText}`
          )
        );
        continue;
      }

      if (char === "/" && src[i + 1] === "*") {
        const startLine = line;
        const startCol = col;
        let commentText = "";
        i += 2;
        col += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
          if (src[i] === "\n") {
            line++;
            col = 1;
          } else {
            col++;
          }
          commentText += src[i];
          i++;
        }
        if (i < src.length) {
          i += 2;
          col += 2;
        }
        tokens.push(
          new BrowCParserToken(
            "COMMENT",
            commentText,
            startLine,
            startCol,
            this.filename,
            `/*${commentText}*/`
          )
        );
        continue;
      }

      // Preprocessor directive
      if (char === "#") {
        const startLine = line;
        const startCol = col;
        let dirText = "";
        while (i < src.length && src[i] !== "\n") {
          dirText += src[i];
          i++;
          col++;
        }
        tokens.push(
          new BrowCParserToken(
            "PP_DIRECTIVE",
            dirText,
            startLine,
            startCol,
            this.filename,
            dirText
          )
        );
        continue;
      }

      // String literal
      if (char === '"') {
        const startLine = line;
        const startCol = col;
        let strVal = "";
        i++;
        col++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === "\\") {
            strVal += src[i];
            i++;
            col++;
          }
          strVal += src[i];
          i++;
          col++;
        }
        if (i < src.length) {
          i++;
          col++;
        }
        tokens.push(
          new BrowCParserToken(
            "STRING_LITERAL",
            strVal,
            startLine,
            startCol,
            this.filename,
            `"${strVal}"`
          )
        );
        continue;
      }

      // Character constant
      if (char === "'") {
        const startLine = line;
        const startCol = col;
        let charVal = "";
        i++;
        col++;
        while (i < src.length && src[i] !== "'") {
          if (src[i] === "\\") {
            charVal += src[i];
            i++;
            col++;
          }
          charVal += src[i];
          i++;
          col++;
        }
        if (i < src.length) {
          i++;
          col++;
        }
        tokens.push(
          new BrowCParserToken(
            "CHARACTER_CONSTANT",
            charVal,
            startLine,
            startCol,
            this.filename,
            `'${charVal}'`
          )
        );
        continue;
      }
      // Numbers
      if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(src[i + 1]))) {
        const startLine = line;
        const startCol = col;
        let numStr = "";
        let isFloat = false;

        while (i < src.length && /[0-9a-fA-F_.]/.test(src[i])) {
          if (src[i] === ".") {
            isFloat = true;
          }
          numStr += src[i];
          i++;
          col++;
        }

        tokens.push(
          new BrowCParserToken(
            isFloat ? "FLOAT_CONSTANT" : "INTEGER_CONSTANT",
            numStr,
            startLine,
            startCol,
            this.filename,
            numStr
          )
        );
        continue;
      }
      // Identifiers / Keywords
      if (/[a-zA-Z_]/.test(char)) {
        const startLine = line;
        const startCol = col;
        let idStr = "";

        while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) {
          idStr += src[i];
          i++;
          col++;
        }

        let type = "IDENTIFIER";
        if (BrowCParser.KEYWORDS.has(idStr)) {
          type = idStr;
        } else if (BrowCParser.BROWC_KEYWORDS.has(idStr)) {
          /*
           * Real bug: this used to set `type = idStr` (e.g. "__js__"), but
           * every call site that cares about the BrowC __js__(...)/__js__(...)
           * extension checks `token.type === "JS_KEYWORD"` - a type string
           * that was never actually produced here. That mismatch meant
           * __js__(...)/__js__(...) tokens fell all the way through
           * parsePrimaryExpression's checks (they aren't INTEGER_CONSTANT,
           * FLOAT_CONSTANT, CHARACTER_CONSTANT, STRING_LITERAL, a plain
           * IDENTIFIER, or "("), and hit the final
           * `throw ... "expected expression, found '<token>'"` - exactly
           * the reported "found '__js__'" / "found '__js__'" errors.
           */
          type = "JS_KEYWORD";
        }

        tokens.push(
          new BrowCParserToken(
            type,
            idStr,
            startLine,
            startCol,
            this.filename,
            idStr
          )
        );
        continue;
      }

      // Operators and Punctuators
      let matchedOp = null;
      for (const op of BrowCParser.MULTI_CHAR_OPERATORS) {
        if (src.startsWith(op, i)) {
          matchedOp = op;
          break;
        }
      }

      if (matchedOp) {
        tokens.push(
          new BrowCParserToken(
            matchedOp,
            matchedOp,
            line,
            col,
            this.filename,
            matchedOp
          )
        );
        i += matchedOp.length;
        col += matchedOp.length;
        continue;
      }

      if (
        BrowCParser.PUNCTUATION.has(char) ||
        BrowCParser.PREFIX_OPERATORS.has(char) ||
        BrowCParser.BINARY_OPERATORS.has(char) ||
        BrowCParser.ASSIGNMENT_OPERATORS.has(char)
      ) {
        tokens.push(
          new BrowCParserToken(char, char, line, col, this.filename, char)
        );
        i++;
        col++;
        continue;
      }

      throw new BrowCParseError(
        `Unexpected character '${char}'`,
        new BrowCParserToken("UNKNOWN", char, line, col, this.filename),
        src
      );
    }

    tokens.push(
      /*
       * value is "EOF" (not "") so that this.at("EOF") - which compares
       * token.value, the same way every other call to at(...) checks
       * punctuation/keywords by value - actually matches the end-of-input
       * sentinel. Previously the sentinel's value was "" while every
       * `while (!this.at("EOF"))` loop and `if (this.at("EOF"))` check
       * compared against the string "EOF", so end-of-input was never
       * detected and parsing always ran past the last real token.
       */
      new BrowCParserToken("EOF", "EOF", line, col, this.filename, "")
    );
    return tokens;
  }

  /* ========================================================
   * PARSER HELPERS
   * ========================================================
   */
  peek(offset = 0) {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1];
    }
    return this.tokens[idx];
  }

  at(type) {
    return this.peek().type === type || this.peek().value === type;
  }

  atType(type) {
    return this.peek().type === type;
  }

  consume() {
    const tok = this.peek();
    if (this.pos < this.tokens.length - 1) {
      this.pos++;
    }
    return tok;
  }

  expect(type) {
    const tok = this.peek();
    if (!this.at(type)) {
      throw new BrowCParseError(
        `Expected '${type}', but got '${tok.value}'`,
        tok,
        this.source
      );
    }
    return this.consume();
  }

  match(type) {
    if (this.at(type)) {
      return this.consume();
    }
    return null;
  }

  node(type, props = {}) {
    /*
     * `type` is placed AFTER `...props` so the node's tag always wins.
     * Several call sites pass a `type` property of their own for the
     * *C* type they're describing (CastExpression's target type,
     * TypeUnaryExpression's sizeof(T)/_Alignof(T) argument type) - with
     * `...props` spread after `type`, that inner `type` field silently
     * clobbered the tag itself (e.g. a CastExpression node's `.type`
     * became the TypeName AST object instead of the string
     * "CastExpression"). Every `switch (node.type)` in the compiler then
     * fell through to its default case for such nodes -
     * "unsupported expression '[object Object]'" - even though a
     * "CastExpression" case existed and was reachable for every other
     * node shape.
     */
    return {
      id: this.nodeId++,
      ...props,
      type,
    };
  }

  /* ========================================================
   * PARSER DIRECTIVES & COMMENTS
   * ========================================================
   */
  parseComment() {
    const tok = this.expect("COMMENT");
    return this.node("Comment", { value: tok.value, raw: tok.raw });
  }

  parsePreprocessorDirective() {
    const tok = this.expect("PP_DIRECTIVE");
    return this.node("PreprocessorDirective", { value: tok.value });
  }

  /* ========================================================
   * DECLARATIONS & EXTERNAL DECLARATIONS
   * ========================================================
   */
  parseExternalDeclaration() {
    const specifiers = this.parseDeclarationSpecifiers();
    let declarator = null;

    if (!this.at(";")) {
      declarator = this.parseDeclarator();
    }

    // Function definition check:
    // If declarator exists, looks like a function, and is followed by {
    if (
      declarator &&
      declarator.type === "FunctionDeclarator" &&
      this.at("{")
    ) {
      this.registerDeclaratorNames(declarator, false);
      this.pushScope();
      this.registerFunctionParameters(declarator);
      const body = this.parseCompoundStatement(false);
      this.popScope();
      return this.node("FunctionDefinition", {
        specifiers,
        declarator,
        body,
      });
    }

    // Standard declaration
    const initDeclarators = [];
    if (declarator) {
      let init = null;
      if (this.match("=")) {
        init = this.parseInitializer();
      }
      initDeclarators.push(
        this.node("InitDeclarator", { declarator, initializer: init })
      );
      this.registerDeclaratorNames(declarator, specifiers.isTypedef);

      while (this.match(",")) {
        const nextDecl = this.parseDeclarator();
        let nextInit = null;
        if (this.match("=")) {
          nextInit = this.parseInitializer();
        }
        initDeclarators.push(
          this.node("InitDeclarator", {
            declarator: nextDecl,
            initializer: nextInit,
          })
        );
        this.registerDeclaratorNames(nextDecl, specifiers.isTypedef);
      }
    }

    this.expect(";");
    return this.node("Declaration", {
      specifiers,
      initDeclarators,
    });
  }

  parseDeclarationSpecifiers() {
    const specifiers = [];
    let isTypedef = false;

    while (!this.at("EOF")) {
      const tok = this.peek();
      const val = tok.value;

      if (BrowCParser.STORAGE_CLASS_SPECIFIERS.has(val)) {
        if (val === "typedef") {
          isTypedef = true;
        }
        specifiers.push(
          this.node("StorageClassSpecifier", { value: this.consume().value })
        );
      } else if (BrowCParser.TYPE_QUALIFIERS.has(val)) {
        specifiers.push(
          this.node("TypeQualifier", { value: this.consume().value })
        );
      } else if (BrowCParser.FUNCTION_SPECIFIERS.has(val)) {
        specifiers.push(
          this.node("FunctionSpecifier", { value: this.consume().value })
        );
      } else if (BrowCParser.BASIC_TYPE_SPECIFIERS.has(val)) {
        specifiers.push(
          this.node("TypeSpecifier", { value: this.consume().value })
        );
      } else if (val === "struct" || val === "union") {
        specifiers.push(this.parseStructOrUnionSpecifier());
      } else if (val === "enum") {
        specifiers.push(this.parseEnumSpecifier());
      } else if (
        (tok.type === "IDENTIFIER" || tok.type === "identifier") &&
        this.isTypedefName(val)
      ) {
        specifiers.push(
          this.node("TypedefName", { name: this.consume().value })
        );
      } else {
        break;
      }
    }

    if (specifiers.length === 0) {
      throw new BrowCParseError(
        `Expected declaration specifiers, got '${this.peek().value}'`,
        this.peek(),
        this.source
      );
    }

    return {
      isTypedef,
      specifiers,
    };
  }

  parseStructOrUnionSpecifier() {
    const kind = this.consume().value; // struct or union
    let name = null;

    if (this.atType("IDENTIFIER") || this.atType("identifier")) {
      name = this.consume().value;
    }

    let members = null;
    if (this.match("{")) {
      members = [];
      while (!this.at("}") && !this.at("EOF")) {
        members.push(this.parseStructDeclaration());
      }
      this.expect("}");
    }

    return this.node("StructOrUnionSpecifier", {
      kind,
      name,
      members,
    });
  }

  parseStructDeclaration() {
    const specifiers = this.parseDeclarationSpecifiers();
    const declarators = [];

    if (!this.at(";")) {
      declarators.push(this.parseDeclarator());
      while (this.match(",")) {
        declarators.push(this.parseDeclarator());
      }
    }

    this.expect(";");
    return this.node("StructDeclaration", { specifiers, declarators });
  }

  parseEnumSpecifier() {
    this.expect("enum");
    let name = null;

    if (this.atType("IDENTIFIER") || this.atType("identifier")) {
      name = this.consume().value;
    }

    let enumerators = null;
    if (this.match("{")) {
      enumerators = [];
      while (!this.at("}") && !this.at("EOF")) {
        const idTok = this.expect("IDENTIFIER");
        let value = null;
        if (this.match("=")) {
          value = this.parseConstantExpression();
        }
        enumerators.push(this.node("Enumerator", { name: idTok.value, value }));
        this.addOrdinaryName(idTok.value);

        if (!this.match(",")) {
          break;
        }
      }
      this.expect("}");
    }

    return this.node("EnumSpecifier", { name, enumerators });
  }

  /* ========================================================
   * DECLARATORS
   * ========================================================
   */
  parseDeclarator() {
    let pointerLevel = 0;
    while (this.match("*")) {
      pointerLevel++;
      // Skip type qualifiers on pointers for simplicity
      while (this.at("const") || this.at("volatile") || this.at("restrict")) {
        this.consume();
      }
    }

    let direct = this.parseDirectDeclarator();

    if (pointerLevel > 0) {
      direct = this.node("PointerDeclarator", {
        pointerLevel,
        declarator: direct,
      });
    }

    return direct;
  }

  parseDirectDeclarator() {
    let base = null;

    if (this.match("(")) {
      base = this.parseDeclarator();
      this.expect(")");
    } else if (this.atType("IDENTIFIER") || this.atType("identifier")) {
      base = this.node("IdentifierDeclarator", { name: this.consume().value });
    } else {
      throw new BrowCParseError(
        `Expected identifier in declarator, got '${this.peek().value}'`,
        this.peek(),
        this.source
      );
    }

    while (true) {
      if (this.match("(")) {
        const params = [];
        let isVariadic = false;

        if (!this.at(")")) {
          while (true) {
            if (this.match("...")) {
              isVariadic = true;
              break;
            }

            const specifiers = this.parseDeclarationSpecifiers();
            let decl = null;
            if (!this.at(",") && !this.at(")")) {
              decl = this.parseDeclarator();
            }

            params.push(
              this.node("ParameterDeclaration", { specifiers, decl })
            );

            if (!this.match(",")) {
              break;
            }
          }
        }

        this.expect(")");
        base = this.node("FunctionDeclarator", {
          declarator: base,
          parameters: params,
          isVariadic,
        });
      } else if (this.match("[")) {
        let size = null;
        if (!this.at("]")) {
          size = this.parseExpression();
        }
        this.expect("]");
        base = this.node("ArrayDeclarator", {
          declarator: base,
          size,
        });
      } else {
        break;
      }
    }

    return base;
  }

  registerDeclaratorNames(declarator, isTypedef) {
    if (!declarator) return;

    if (declarator.type === "IdentifierDeclarator") {
      if (isTypedef) {
        this.addTypedefName(declarator.name);
      } else {
        this.addOrdinaryName(declarator.name);
      }
    } else if (
      declarator.type === "PointerDeclarator" ||
      declarator.type === "FunctionDeclarator" ||
      declarator.type === "ArrayDeclarator"
    ) {
      this.registerDeclaratorNames(declarator.declarator, isTypedef);
    }
  }

  registerFunctionParameters(declarator) {
    if (declarator.type === "FunctionDeclarator") {
      for (const param of declarator.parameters) {
        if (param.decl) {
          this.registerDeclaratorNames(param.decl, false);
        }
      }
    }
  }

  /* ========================================================
   * INITIALIZERS
   * ========================================================
   */
  parseInitializer() {
    if (this.match("{")) {
      const initializers = [];
      while (!this.at("}") && !this.at("EOF")) {
        initializers.push(this.parseInitializer());
        if (!this.match(",")) {
          break;
        }
      }
      this.expect("}");
      return this.node("InitializerList", { initializers });
    }

    return this.parseAssignmentExpression();
  }

  /* ========================================================
   * STATEMENTS
   * ========================================================
   */
  parseStatement() {
    if (this.atType("COMMENT")) {
      return this.parseComment();
    }

    if (this.at("{")) {
      this.pushScope();
      const compound = this.parseCompoundStatement(true);
      this.popScope();
      return compound;
    }

    if (this.match("if")) {
      this.expect("(");
      const test = this.parseExpression();
      this.expect(")");
      const consequent = this.parseStatement();
      let alternate = null;
      if (this.match("else")) {
        alternate = this.parseStatement();
      }
      return this.node("IfStatement", { test, consequent, alternate });
    }

    if (this.match("while")) {
      this.expect("(");
      const test = this.parseExpression();
      this.expect(")");
      const body = this.parseStatement();
      return this.node("WhileStatement", { test, body });
    }

    if (this.match("do")) {
      const body = this.parseStatement();
      this.expect("while");
      this.expect("(");
      const test = this.parseExpression();
      this.expect(")");
      this.expect(";");
      return this.node("DoWhileStatement", { test, body });
    }

    if (this.match("for")) {
      this.pushScope();
      this.expect("(");
      let init = null;

      if (!this.at(";")) {
        if (this.isDeclarationStart()) {
          init = this.parseExternalDeclaration();
        } else {
          init = this.parseExpression();
          this.expect(";");
        }
      } else {
        this.expect(";");
      }

      let test = null;
      if (!this.at(";")) {
        test = this.parseExpression();
      }
      this.expect(";");

      let update = null;
      if (!this.at(")")) {
        update = this.parseExpression();
      }
      this.expect(")");

      const body = this.parseStatement();
      this.popScope();

      return this.node("ForStatement", { init, test, update, body });
    }

    if (this.match("return")) {
      let argument = null;
      if (!this.at(";")) {
        argument = this.parseExpression();
      }
      this.expect(";");
      return this.node("ReturnStatement", { argument });
    }

    if (this.match("break")) {
      this.expect(";");
      return this.node("BreakStatement");
    }

    if (this.match("continue")) {
      this.expect(";");
      return this.node("ContinueStatement");
    }

    if (this.match("switch")) {
      this.expect("(");
      const discriminant = this.parseExpression();
      this.expect(")");
      const body = this.parseStatement();
      return this.node("SwitchStatement", { discriminant, body });
    }

    if (this.match("case")) {
      const test = this.parseConstantExpression();
      this.expect(":");
      const consequent = this.parseStatement();
      return this.node("CaseStatement", { test, consequent });
    }

    if (this.match("default")) {
      this.expect(":");
      const consequent = this.parseStatement();
      return this.node("DefaultStatement", { consequent });
    }

    if (this.match("goto")) {
      const labelTok = this.expect("IDENTIFIER");
      this.expect(";");
      return this.node("GotoStatement", { label: labelTok.value });
    }

    // Label statement
    if (
      (this.peek(0).type === "IDENTIFIER" ||
        this.peek(0).type === "identifier") &&
      this.peek(1).value === ":"
    ) {
      const label = this.consume().value;
      this.expect(":");
      const statement = this.parseStatement();
      return this.node("LabeledStatement", { label, statement });
    }

    // Empty statement
    if (this.match(";")) {
      return this.node("EmptyStatement");
    }

    // Expression statement
    const expr = this.parseExpression();
    this.expect(";");
    return this.node("ExpressionStatement", { expression: expr });
  }

  parseCompoundStatement(shouldManageScope = true) {
    this.expect("{");
    if (shouldManageScope) {
      // Scope pushed outside or handled by parent statement
    }

    const items = [];
    while (!this.at("}") && !this.at("EOF")) {
      if (this.atType("COMMENT")) {
        items.push(this.parseComment());
      } else if (this.atType("PP_DIRECTIVE")) {
        items.push(this.parsePreprocessorDirective());
      } else if (this.isDeclarationStart()) {
        items.push(this.parseExternalDeclaration());
      } else {
        items.push(this.parseStatement());
      }
    }

    this.expect("}");
    return this.node("CompoundStatement", { items });
  }

  /* ========================================================
   * EXPRESSIONS
   * ========================================================
   */
  parseExpression() {
    let expr = this.parseAssignmentExpression();

    while (this.match(",")) {
      const right = this.parseAssignmentExpression();
      expr = this.node("SequenceExpression", {
        left: expr,
        right,
      });
    }

    return expr;
  }

  parseConstantExpression() {
    return this.parseConditionalExpression();
  }

  parseAssignmentExpression() {
    const left = this.parseConditionalExpression();

    if (BrowCParser.ASSIGNMENT_OPERATORS.has(this.peek().value)) {
      const operator = this.consume().value;
      const right = this.parseAssignmentExpression();
      return this.node("AssignmentExpression", {
        operator,
        left,
        right,
      });
    }

    return left;
  }

  parseConditionalExpression() {
    let expr = this.parseLogicalOrExpression();

    if (this.match("?")) {
      const consequent = this.parseExpression();
      this.expect(":");
      const alternate = this.parseConditionalExpression();
      expr = this.node("ConditionalExpression", {
        test: expr,
        consequent,
        alternate,
      });
    }

    return expr;
  }

  parseLogicalOrExpression() {
    let left = this.parseLogicalAndExpression();
    while (this.match("||")) {
      const right = this.parseLogicalAndExpression();
      left = this.node("BinaryExpression", { operator: "||", left, right });
    }
    return left;
  }

  parseLogicalAndExpression() {
    let left = this.parseBitwiseOrExpression();
    while (this.match("&&")) {
      const right = this.parseBitwiseOrExpression();
      left = this.node("BinaryExpression", { operator: "&&", left, right });
    }
    return left;
  }

  parseBitwiseOrExpression() {
    let left = this.parseBitwiseXorExpression();
    while (this.match("|")) {
      const right = this.parseBitwiseXorExpression();
      left = this.node("BinaryExpression", { operator: "|", left, right });
    }
    return left;
  }

  parseBitwiseXorExpression() {
    let left = this.parseBitwiseAndExpression();
    while (this.match("^")) {
      const right = this.parseBitwiseAndExpression();
      left = this.node("BinaryExpression", { operator: "^", left, right });
    }
    return left;
  }

  parseBitwiseAndExpression() {
    let left = this.parseEqualityExpression();
    while (this.match("&")) {
      const right = this.parseEqualityExpression();
      left = this.node("BinaryExpression", { operator: "&", left, right });
    }
    return left;
  }

  parseEqualityExpression() {
    let left = this.parseRelationalExpression();
    while (this.at("==") || this.at("!=")) {
      const operator = this.consume().value;
      const right = this.parseRelationalExpression();
      left = this.node("BinaryExpression", { operator, left, right });
    }
    return left;
  }

  parseRelationalExpression() {
    let left = this.parseShiftExpression();
    while (this.at("<") || this.at(">") || this.at("<=") || this.at(">=")) {
      const operator = this.consume().value;
      const right = this.parseShiftExpression();
      left = this.node("BinaryExpression", { operator, left, right });
    }
    return left;
  }

  parseShiftExpression() {
    let left = this.parseAdditiveExpression();
    while (this.at("<<") || this.at(">>")) {
      const operator = this.consume().value;
      const right = this.parseAdditiveExpression();
      left = this.node("BinaryExpression", { operator, left, right });
    }
    return left;
  }

  parseAdditiveExpression() {
    let left = this.parseMultiplicativeExpression();
    while (this.at("+") || this.at("-")) {
      const operator = this.consume().value;
      const right = this.parseMultiplicativeExpression();
      left = this.node("BinaryExpression", { operator, left, right });
    }
    return left;
  }

  parseMultiplicativeExpression() {
    let left = this.parseCastExpression();
    while (this.at("*") || this.at("/") || this.at("%")) {
      const operator = this.consume().value;
      const right = this.parseCastExpression();
      left = this.node("BinaryExpression", { operator, left, right });
    }
    return left;
  }

  parseCastExpression() {
    if (this.at("(") && this.isCastParenthesis()) {
      this.expect("(");
      const specifiers = this.parseDeclarationSpecifiers();
      let declarator = null;
      if (!this.at(")")) {
        declarator = this.parseDeclarator();
      }
      this.expect(")");
      const expression = this.parseCastExpression();
      return this.node("CastExpression", {
        typeAnnotation: { specifiers, declarator },
        expression,
      });
    }

    return this.parseUnaryExpression();
  }

  isCastParenthesis() {
    // Look ahead past '(' to see if it starts type specifiers
    const nextTok = this.peek(1);
    if (!nextTok) return false;
    const val = nextTok.value;

    return (
      BrowCParser.BASIC_TYPE_SPECIFIERS.has(val) ||
      BrowCParser.TYPE_QUALIFIERS.has(val) ||
      val === "struct" ||
      val === "union" ||
      val === "enum" ||
      this.isTypedefName(val)
    );
  }

  parseUnaryExpression() {
    if (BrowCParser.PREFIX_OPERATORS.has(this.peek().value)) {
      const operator = this.consume().value;
      const argument = this.parseCastExpression();
      return this.node("UnaryExpression", {
        operator,
        argument,
        prefix: true,
      });
    }

    if (this.match("sizeof")) {
      if (this.at("(") && this.isCastParenthesis()) {
        this.expect("(");
        const specifiers = this.parseDeclarationSpecifiers();
        let declarator = null;
        if (!this.at(")")) {
          declarator = this.parseDeclarator();
        }
        this.expect(")");
        return this.node("SizeofTypeNameExpression", {
          typeAnnotation: { specifiers, declarator },
        });
      }
      const argument = this.parseUnaryExpression();
      return this.node("SizeofExpression", { argument });
    }

    return this.parsePostfixExpression();
  }

  parsePostfixExpression() {
    let expr = this.parsePrimaryExpression();

    while (true) {
      if (this.match("[")) {
        const index = this.parseExpression();
        this.expect("]");
        expr = this.node("MemberAccessExpression", {
          object: expr,
          property: index,
          computed: true,
        });
      } else if (this.match("(")) {
        const args = [];
        if (!this.at(")")) {
          while (true) {
            args.push(this.parseAssignmentExpression());
            if (!this.match(",")) {
              break;
            }
          }
        }
        this.expect(")");
        expr = this.node("CallExpression", {
          callee: expr,
          arguments: args,
        });
      } else if (this.match(".")) {
        const propTok = this.expect("IDENTIFIER");
        expr = this.node("MemberAccessExpression", {
          object: expr,
          property: this.node("Identifier", { name: propTok.value }),
          computed: false,
        });
      } else if (this.match("->")) {
        const propTok = this.expect("IDENTIFIER");
        expr = this.node("PointerMemberAccessExpression", {
          object: expr,
          property: this.node("Identifier", { name: propTok.value }),
        });
      } else if (this.at("++") || this.at("--")) {
        const operator = this.consume().value;
        expr = this.node("UnaryExpression", {
          operator,
          argument: expr,
          prefix: false,
        });
      } else {
        break;
      }
    }

    return expr;
  }

  parsePrimaryExpression() {
    if (this.atType("INTEGER_CONSTANT")) {
      return this.node("Literal", {
        kind: "integer",
        value: this.consume().value,
      });
    }

    if (this.atType("FLOAT_CONSTANT")) {
      return this.node("Literal", {
        kind: "float",
        value: this.consume().value,
      });
    }

    if (this.atType("CHARACTER_CONSTANT")) {
      return this.node("Literal", {
        kind: "character",
        value: this.consume().value,
      });
    }

    if (this.atType("STRING_LITERAL")) {
      return this.node("Literal", {
        kind: "string",
        value: this.consume().value,
      });
    }

    // BrowC __js__(...) extension
    if (this.match("__js__")) {
      this.expect("(");
      const codeExpr = this.parseAssignmentExpression();
      this.expect(")");
      return this.node("BrowCJsExpression", { code: codeExpr });
    }

    if (this.atType("IDENTIFIER") || this.atType("identifier")) {
      return this.node("Identifier", { name: this.consume().value });
    }

    if (this.match("(")) {
      const expr = this.parseExpression();
      this.expect(")");
      return expr;
    }

    throw new BrowCParseError(
      `Unexpected token '${this.peek().value}' in primary expression`,
      this.peek(),
      this.source
    );
  }
  /* ========================================================
   * LEXER HELPERS
   * ========================================================
   */
  isIdentifierStart(ch) {
    return typeof ch === "string" && /^[A-Za-z_]$/.test(ch);
  }
  isIdentifierPart(ch) {
    return typeof ch === "string" && /^[A-Za-z0-9_]$/.test(ch);
  }
  isDigit(ch) {
    return typeof ch === "string" && /^[0-9]$/.test(ch);
  }
  linePrefixIsWhitespace(source, index) {
    let i = index - 1;
    while (i >= 0 && (source[i] === " " || source[i] === "\t")) {
      i--;
    }
    return i < 0 || source[i] === "\n";
  }
  readNumericLiteral(source, current, nextChar, getIndex, setIndex) {
    let text = "";
    let index = getIndex();
    const take = () => {
      text += nextChar();
      index = getIndex();
    };
    /*
     * hexadecimal
     */
    if (
      current() === "0" &&
      (source[index + 1] === "x" || source[index + 1] === "X")
    ) {
      take();
      take();
      while (/^[0-9A-Fa-f']$/.test(current() || "")) {
        take();
      }
      if (current() === ".") {
        take();
        while (/^[0-9A-Fa-f']$/.test(current() || "")) {
          take();
        }
      }
      if (current() === "p" || current() === "P") {
        take();
        if (current() === "+" || current() === "-") {
          take();
        }
        while (/^[0-9']$/.test(current() || "")) {
          take();
        }
      }
      while (/[fFlL]/.test(current() || "")) {
        take();
      }
      return text;
    }
    /*
     * binary extension
     *
     * BrowC accepts it, although binary integer literals are
     * not part of C99.
     */
    if (
      current() === "0" &&
      (source[index + 1] === "b" || source[index + 1] === "B")
    ) {
      take();
      take();
      while (/^[01']$/.test(current() || "")) {
        take();
      }
      while (/[uUlL]/.test(current() || "")) {
        take();
      }
      return text;
    }
    /*
     * decimal / octal / floating
     */
    if (current() === ".") {
      take();
      while (/^[0-9']$/.test(current() || "")) {
        take();
      }
    } else {
      while (/^[0-9']$/.test(current() || "")) {
        take();
      }
      if (current() === ".") {
        take();
        while (/^[0-9']$/.test(current() || "")) {
          take();
        }
      }
    }
    if (current() === "e" || current() === "E") {
      take();
      if (current() === "+" || current() === "-") {
        take();
      }
      while (/^[0-9']$/.test(current() || "")) {
        take();
      }
    }
    while (/[uUlLfF]/.test(current() || "")) {
      take();
    }
    return text;
  }
  /* ========================================================
   * TOKEN HELPERS
   * ========================================================
   */
  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }
  previous() {
    return this.tokens[Math.max(0, this.pos - 1)];
  }
  at(value) {
    return this.peek().value === value;
  }
  atType(type) {
    return this.peek().type === type;
  }
  advance() {
    return this.tokens[this.pos++];
  }
  match(value) {
    if (this.at(value)) {
      return this.advance();
    }
    return null;
  }
  expect(value, customMessage = null) {
    if (!this.at(value)) {
      const token = this.peek();
      throw new BrowCParseError(
        customMessage || `expected '${value}', found '${token.value}'`,
        token,
        this.source
      );
    }
    return this.advance();
  }
  expectIdentifier(message = "expected identifier") {
    const token = this.peek();
    if (token.type !== "IDENTIFIER" && token.type !== "TYPEDEF_NAME") {
      throw new BrowCParseError(
        `${message}, found '${token.value}'`,
        token,
        this.source
      );
    }
    return this.advance();
  }
  skipComments() {
    while (this.atType("COMMENT")) {
      this.advance();
    }
  }
  /* ========================================================
   * SCOPES / TYPEDEF NAMES
   * ========================================================
   */
  currentScope() {
    return this.scopes[this.scopes.length - 1];
  }
  enterScope() {
    this.scopes.push({
      ordinary: new Set(),
      typedefs: new Set(),
      tags: new Set(),
      labels: new Set(),
    });
  }
  leaveScope() {
    if (this.scopes.length > 1) {
      this.scopes.pop();
    }
  }
  isTypedefName(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].typedefs.has(name)) {
        return true;
      }
      if (this.scopes[i].ordinary.has(name)) {
        return false;
      }
    }
    return false;
  }
  /*
   * Tokens are produced by the lexer with type "IDENTIFIER" only - there is
   * no separate lexical "TYPEDEF_NAME" token kind (C's lexer/parser
   * ambiguity is resolved contextually, using the scope-tracked typedef
   * table above, not by the lexer). Call sites that need to know whether
   * the token currently in view names a known type should use this helper
   * rather than comparing token.type to the string "TYPEDEF_NAME" - that
   * comparison can never be true since nothing ever assigns that type.
   */
  isTypedefNameToken(token) {
    return (
      !!token && token.type === "IDENTIFIER" && this.isTypedefName(token.value)
    );
  }
  declareOrdinary(name) {
    if (!name) return;
    this.currentScope().ordinary.add(name);
  }
  declareTypedef(name) {
    if (!name) return;
    this.currentScope().typedefs.add(name);
  }
  declareTag(name) {
    if (!name) return;
    this.currentScope().tags.add(name);
  }
  declareLabel(name) {
    if (!name) return;
    this.currentScope().labels.add(name);
  }
  /* ========================================================
   * AST
   * ========================================================
   */
  node(type, fields = {}) {
    return {
      id: this.nodeId++,
      type,
      ...fields,
    };
  }
  /* ========================================================
   * PREPROCESSOR
   * ========================================================
   */
  parsePreprocessorDirective() {
    const token = this.advance();
    return this.node("PreprocessorDirective", {
      text: token.value,
    });
  }
  /* ========================================================
   * COMMENTS
   * ========================================================
   */
  parseComment() {
    const token = this.advance();
    return this.node("Comment", {
      kind: token.value.startsWith("//") ? "line" : "block",
      text: token.value,
    });
  }
  /* ========================================================
   * EXTERNAL DECLARATIONS
   * ========================================================
   */
  parseExternalDeclaration() {
    /*
     * Allow declarations/specifiers first.
     */
    const specifiers = this.parseDeclarationSpecifiers();
    /*
     * Empty declaration:
     *
     *   int;
     */
    if (this.match(";")) {
      return this.node("Declaration", {
        specifiers,
        declarators: [],
      });
    }
    /*
     * Parse first declarator.
     */
    const declarator = this.parseDeclarator(false);
    /*
     * Function definition.
     */
    if (this.at("{") && declarator.kind === "function") {
      const body = this.parseCompoundStatement();
      return this.node("FunctionDefinition", {
        specifiers,
        declarator,
        body,
      });
    }
    /*
     * Regular declaration.
     */
    const declarators = [];
    declarators.push(this.finishInitDeclarator(declarator));
    while (this.match(",")) {
      declarators.push(this.finishInitDeclarator(this.parseDeclarator(false)));
    }
    this.expect(";");
    this.registerDeclarationNames(specifiers, declarators);
    return this.node("Declaration", {
      specifiers,
      declarators,
    });
  }
  /* ========================================================
   * DECLARATION SPECIFIERS
   * ========================================================
   */
  parseDeclarationSpecifiers() {
    const specifiers = [];
    let found = false;
    while (true) {
      const token = this.peek();
      /*
       * storage class
       */
      if (BrowCParser.STORAGE_CLASS_SPECIFIERS.has(token.value)) {
        specifiers.push(
          this.node("StorageClassSpecifier", {
            value: this.advance().value,
          })
        );
        found = true;
        continue;
      }
      /*
       * type qualifiers
       */
      if (BrowCParser.TYPE_QUALIFIERS.has(token.value)) {
        specifiers.push(
          this.node("TypeQualifier", {
            value: this.advance().value,
          })
        );
        found = true;
        continue;
      }
      /*
       * function specifier
       */
      if (BrowCParser.FUNCTION_SPECIFIERS.has(token.value)) {
        specifiers.push(
          this.node("FunctionSpecifier", {
            value: this.advance().value,
          })
        );
        found = true;
        continue;
      }
      /*
       * _Alignas
       */
      if (token.value === "_Alignas") {
        this.advance();
        this.expect("(");
        let value;
        if (this.looksLikeTypeName()) {
          value = this.parseTypeName();
        } else {
          value = this.parseAssignmentExpression();
        }
        this.expect(")");
        specifiers.push(
          this.node("AlignmentSpecifier", {
            value,
          })
        );
        found = true;
        continue;
      }
      /*
       * _Atomic(...)
       */
      if (token.value === "_Atomic" && this.peek(1).value === "(") {
        this.advance();
        this.expect("(");
        const type = this.parseTypeName();
        this.expect(")");
        specifiers.push(
          this.node("AtomicTypeSpecifier", {
            type,
          })
        );
        found = true;
        continue;
      }
      /*
       * ordinary type specifier
       */
      if (this.isTypeSpecifier(token)) {
        specifiers.push(this.parseTypeSpecifier());
        found = true;
        continue;
      }
      break;
    }
    if (!found) {
      throw new BrowCParseError(
        "expected declaration specifier",
        this.peek(),
        this.source
      );
    }
    return specifiers;
  }
  /*
   * Used by _Alignas(...) and other contexts that need to know, without
   * consuming input, whether what follows looks like a type-name (a
   * declaration specifier list optionally followed by an abstract
   * declarator) rather than an expression.
   */
  looksLikeTypeName() {
    return (
      this.isTypeSpecifier(this.peek()) ||
      BrowCParser.TYPE_QUALIFIERS.has(this.peek().value)
    );
  }
  isTypeSpecifier(token) {
    return (
      BrowCParser.BASIC_TYPE_SPECIFIERS.has(token.value) ||
      this.isTypedefNameToken(token) ||
      token.value === "struct" ||
      token.value === "union" ||
      token.value === "enum"
    );
  }
  /* ========================================================
   * TYPE SPECIFIER
   * ========================================================
   */
  parseTypeSpecifier() {
    const token = this.peek();
    /*
     * struct / union
     */
    if (token.value === "struct" || token.value === "union") {
      return this.parseStructOrUnionSpecifier();
    }
    /*
     * enum
     */
    if (token.value === "enum") {
      return this.parseEnumSpecifier();
    }
    /*
     * typedef-name
     */
    if (this.isTypedefNameToken(token)) {
      this.advance();
      return this.node("TypedefNameSpecifier", {
        name: token.value,
      });
    }
    /*
     * builtin
     */
    if (BrowCParser.BASIC_TYPE_SPECIFIERS.has(token.value)) {
      this.advance();
      return this.node("BuiltinTypeSpecifier", {
        name: token.value,
      });
    }
    throw new BrowCParseError(
      `unknown type specifier '${token.value}'`,
      token,
      this.source
    );
  }
  /* ========================================================
   * STRUCT / UNION
   * ========================================================
   */
  parseStructOrUnionSpecifier() {
    const kind = this.advance().value;
    let tag = null;
    if (
      this.peek().type === "IDENTIFIER" ||
      this.peek().type === "TYPEDEF_NAME"
    ) {
      tag = this.advance().value;
    }
    let fields = null;
    if (this.match("{")) {
      fields = [];
      if (tag) {
        this.declareTag(tag);
      }
      this.enterScope();
      while (!this.at("}")) {
        const fieldSpecifiers = this.parseDeclarationSpecifiers();
        const fieldDeclarators = [];
        /*
         * C bit-fields may be declared without
         * a normal declarator.
         */
        if (this.at(":")) {
          this.advance();
          const width = this.parseConstantExpression();
          fieldDeclarators.push(
            this.node("BitField", {
              declarator: null,
              width,
            })
          );
        } else {
          fieldDeclarators.push(this.parseFieldDeclarator());
          while (this.match(",")) {
            fieldDeclarators.push(this.parseFieldDeclarator());
          }
        }
        this.expect(";");
        fields.push(
          this.node("StructFieldDeclaration", {
            specifiers: fieldSpecifiers,
            declarators: fieldDeclarators,
          })
        );
      }
      this.expect("}");
      this.leaveScope();
    }
    return this.node("StructOrUnionSpecifier", {
      kind,
      tag,
      fields,
    });
  }
  parseFieldDeclarator() {
    const declarator = this.parseDeclarator(true);
    if (this.match(":")) {
      const width = this.parseConstantExpression();
      return this.node("BitField", {
        declarator,
        width,
      });
    }
    return this.node("FieldDeclarator", {
      declarator,
    });
  }
  /* ========================================================
   * ENUM
   * ========================================================
   */
  parseEnumSpecifier() {
    this.expect("enum");
    let tag = null;
    if (
      this.peek().type === "IDENTIFIER" ||
      this.peek().type === "TYPEDEF_NAME"
    ) {
      tag = this.advance().value;
    }
    let enumerators = null;
    if (this.match("{")) {
      enumerators = [];
      while (!this.at("}")) {
        const id = this.expectIdentifier("expected enumerator identifier");
        let value = null;
        if (this.match("=")) {
          value = this.parseConstantExpression();
        }
        enumerators.push(
          this.node("Enumerator", {
            name: id.value,
            value,
          })
        );
        if (!this.match(",")) {
          break;
        }
        if (this.at("}")) {
          break;
        }
      }
      this.expect("}");
    }
    if (tag) {
      this.declareTag(tag);
    }
    return this.node("EnumSpecifier", {
      tag,
      enumerators,
    });
  }
  /* ========================================================
   * DECLARATORS
   * ========================================================
   */
  parseDeclarator(allowAbstract = false) {
    const pointer = this.parsePointer();
    const direct = this.parseDirectDeclarator(allowAbstract);
    return this.node("Declarator", {
      pointer,
      direct,
      name: this.extractDeclaratorName(direct),
      kind: this.declaratorIsFunction(direct) ? "function" : "object",
    });
  }
  parsePointer() {
    if (!this.match("*")) {
      return null;
    }
    const qualifiers = [];
    while (BrowCParser.TYPE_QUALIFIERS.has(this.peek().value)) {
      qualifiers.push(this.advance().value);
    }
    const nested = this.parsePointer();
    return this.node("Pointer", {
      qualifiers,
      next: nested,
    });
  }
  parseDirectDeclarator(allowAbstract = false) {
    let declarator;
    /*
     * identifier
     */
    if (
      this.peek().type === "IDENTIFIER" ||
      this.peek().type === "TYPEDEF_NAME"
    ) {
      declarator = this.node("IdentifierDeclarator", {
        name: this.advance().value,
      });
    } else if (this.match("(")) {
      /*
       * parenthesized declarator
       */
      const inner = this.parseDeclarator(true);
      this.expect(")");
      declarator = this.node("ParenthesizedDeclarator", {
        declarator: inner,
      });
    } else if (allowAbstract) {
      /*
       * abstract declarator
       */
      declarator = this.node("AbstractDeclarator");
    } else {
      throw new BrowCParseError(
        "expected declarator",
        this.peek(),
        this.source
      );
    }
    /*
     * suffixes
     */
    while (true) {
      /*
       * function declarator
       */
      if (this.match("(")) {
        const parameters = [];
        let variadic = false;
        if (!this.at(")")) {
          /*
           * (... only)
           */
          if (this.match("...")) {
            variadic = true;
          } else {
            /*
             * special case: (void)
             */
            if (this.at("void") && this.peek(1).value === ")") {
              const specs = this.parseDeclarationSpecifiers();
              parameters.push(
                this.node("Parameter", {
                  specifiers: specs,
                  declarator: null,
                })
              );
            } else {
              while (true) {
                const specs = this.parseDeclarationSpecifiers();
                let decl = null;
                if (!this.at(",") && !this.at(")")) {
                  decl = this.parseDeclarator(true);
                }
                parameters.push(
                  this.node("Parameter", {
                    specifiers: specs,
                    declarator: decl,
                  })
                );
                if (!this.match(",")) {
                  break;
                }
                if (this.match("...")) {
                  variadic = true;
                  break;
                }
              }
            }
          }
        }
        this.expect(")");
        declarator = this.node("FunctionDeclarator", {
          declarator,
          parameters,
          variadic,
        });
        continue;
      }
      /*
       * array declarator
       */
      if (this.match("[")) {
        const qualifiers = [];
        let isStatic = false;
        let isVLA = false;
        while (BrowCParser.TYPE_QUALIFIERS.has(this.peek().value)) {
          qualifiers.push(this.advance().value);
        }
        if (this.match("static")) {
          isStatic = true;
        }
        let size = null;
        if (!this.at("]")) {
          size = this.parseAssignmentExpression();
        }
        this.expect("]");
        if (!size) {
          isVLA = true;
        }
        declarator = this.node("ArrayDeclarator", {
          declarator,
          qualifiers,
          static: isStatic,
          vla: isVLA,
          size,
        });
        continue;
      }
      break;
    }
    return declarator;
  }
  declaratorIsFunction(node) {
    if (!node) {
      return false;
    }
    if (node.type === "FunctionDeclarator") {
      return true;
    }
    if (node.declarator) {
      return this.declaratorIsFunction(node.declarator);
    }
    return false;
  }
  extractDeclaratorName(node) {
    if (!node) {
      return null;
    }
    if (node.type === "IdentifierDeclarator") {
      return node.name;
    }
    if (node.declarator) {
      return this.extractDeclaratorName(node.declarator);
    }
    return null;
  }
  parseTypeName() {
    const specifiers = this.parseDeclarationSpecifiers();
    let declarator = null;
    /*
     * A type-name may have an abstract declarator.
     */
    if (this.canStartAbstractDeclarator()) {
      declarator = this.parseDeclarator(true);
    }
    return this.node("TypeName", {
      specifiers,
      declarator,
    });
  }
  canStartAbstractDeclarator() {
    return this.at("*") || this.at("(") || this.at("[");
  }
  /* ========================================================
   * INITIALIZERS
   * ========================================================
   */
  finishInitDeclarator(declarator) {
    let initializer = null;
    if (this.match("=")) {
      initializer = this.parseInitializer();
    }
    return this.node("InitDeclarator", {
      declarator,
      initializer,
    });
  }
  parseInitializer() {
    /*
     * brace initializer
     */
    if (this.match("{")) {
      const items = [];
      while (!this.at("}")) {
        const designators = [];
        /*
         * designated initializer
         *
         * .field = value
         *
         * [expr] = value
         */
        while (this.at(".") || this.at("[")) {
          if (this.match(".")) {
            const id = this.expectIdentifier("expected field name after '.'");
            designators.push(
              this.node("FieldDesignator", {
                name: id.value,
              })
            );
          } else {
            this.expect("[");
            const first = this.parseExpression();
            let last = null;
            if (this.match("...")) {
              last = this.parseExpression();
            }
            this.expect("]");
            designators.push(
              this.node("IndexDesignator", {
                first,
                last,
              })
            );
          }
        }
        if (designators.length > 0) {
          this.expect("=");
        }
        const initializer = this.parseInitializer();
        items.push(
          this.node("InitializerItem", {
            designators,
            initializer,
          })
        );
        if (!this.match(",")) {
          break;
        }
      }
      this.expect("}");
      return this.node("InitializerList", {
        items,
      });
    }
    return this.parseAssignmentExpression();
  }
  /* ========================================================
   * DECLARATION REGISTRATION
   * ========================================================
   */
  registerDeclarationNames(specifiers, declarators) {
    const typedef = specifiers.some(
      (x) => x.type === "StorageClassSpecifier" && x.value === "typedef"
    );
    for (const item of declarators) {
      const name = this.extractDeclaratorName(item.declarator);
      if (!name) {
        continue;
      }
      if (typedef) {
        this.declareTypedef(name);
      } else {
        this.declareOrdinary(name);
      }
    }
  }
  /* ========================================================
   * COMPOUND STATEMENT
   * ========================================================
   */
  parseCompoundStatement() {
    this.expect("{");
    this.enterScope();
    const statements = [];
    while (!this.at("}")) {
      if (this.at("EOF")) {
        throw new BrowCParseError(
          "expected '}' before end of file",
          this.peek(),
          this.source
        );
      }
      if (this.atType("COMMENT")) {
        statements.push(this.parseComment());
        continue;
      }
      if (this.atType("PP_DIRECTIVE")) {
        statements.push(this.parsePreprocessorDirective());
        continue;
      }
      if (this.isDeclarationStart()) {
        const declaration = this.parseBlockDeclaration();
        statements.push(declaration);
      } else {
        statements.push(this.parseStatement());
      }
    }
    this.expect("}");
    this.leaveScope();
    return this.node("CompoundStatement", {
      body: statements,
    });
  }
  parseBlockDeclaration() {
    const specifiers = this.parseDeclarationSpecifiers();
    const declarators = [];
    if (!this.at(";")) {
      declarators.push(this.finishInitDeclarator(this.parseDeclarator(false)));
      while (this.match(",")) {
        declarators.push(
          this.finishInitDeclarator(this.parseDeclarator(false))
        );
      }
    }
    this.expect(";");
    this.registerDeclarationNames(specifiers, declarators);
    return this.node("Declaration", {
      specifiers,
      declarators,
    });
  }
  /* ========================================================
   * STATEMENTS
   * ========================================================
   */
  parseStatement() {
    /*
     * compound
     */
    if (this.at("{")) {
      return this.parseCompoundStatement();
    }
    /*
     * null
     */
    if (this.match(";")) {
      return this.node("NullStatement");
    }
    /*
     * if
     */
    if (this.match("if")) {
      this.expect("(");
      const condition = this.parseExpression();
      this.expect(")");
      const thenBranch = this.parseStatement();
      let elseBranch = null;
      if (this.match("else")) {
        elseBranch = this.parseStatement();
      }
      return this.node("IfStatement", {
        condition,
        thenBranch,
        elseBranch,
      });
    }
    /*
     * switch
     */
    if (this.match("switch")) {
      this.expect("(");
      const expression = this.parseExpression();
      this.expect(")");
      const body = this.parseStatement();
      return this.node("SwitchStatement", {
        expression,
        body,
      });
    }
    /*
     * while
     */
    if (this.match("while")) {
      this.expect("(");
      const condition = this.parseExpression();
      this.expect(")");
      const body = this.parseStatement();
      return this.node("WhileStatement", {
        condition,
        body,
      });
    }
    /*
     * do while
     */
    if (this.match("do")) {
      const body = this.parseStatement();
      this.expect("while");
      this.expect("(");
      const condition = this.parseExpression();
      this.expect(")");
      this.expect(";");
      return this.node("DoWhileStatement", {
        body,
        condition,
      });
    }
    /*
     * for
     */
    if (this.match("for")) {
      this.expect("(");
      let init = null;
      if (this.isDeclarationStart()) {
        init = this.parseBlockDeclaration();
      } else {
        if (!this.at(";")) {
          init = this.parseExpression();
        }
        this.expect(";");
      }
      let condition = null;
      if (!this.at(";")) {
        condition = this.parseExpression();
      }
      this.expect(";");
      let iteration = null;
      if (!this.at(")")) {
        iteration = this.parseExpression();
      }
      this.expect(")");
      const body = this.parseStatement();
      return this.node("ForStatement", {
        init,
        condition,
        iteration,
        body,
      });
    }
    /*
     * break
     */
    if (this.match("break")) {
      this.expect(";");
      return this.node("BreakStatement");
    }
    /*
     * continue
     */
    if (this.match("continue")) {
      this.expect(";");
      return this.node("ContinueStatement");
    }
    /*
     * return
     */
    if (this.match("return")) {
      let expression = null;
      if (!this.at(";")) {
        expression = this.parseExpression();
      }
      this.expect(";");
      return this.node("ReturnStatement", {
        expression,
      });
    }
    /*
     * goto
     */
    if (this.match("goto")) {
      const label = this.expectIdentifier("expected label after goto");
      this.expect(";");
      return this.node("GotoStatement", {
        label: label.value,
      });
    }
    /*
     * case
     */
    if (this.match("case")) {
      const expression = this.parseConstantExpression();
      this.expect(":");
      const statement = this.parseStatement();
      return this.node("CaseStatement", {
        expression,
        statement,
      });
    }
    /*
     * default
     */
    if (this.match("default")) {
      this.expect(":");
      const statement = this.parseStatement();
      return this.node("DefaultStatement", {
        statement,
      });
    }
    /*
     * label
     */
    if (
      (this.peek().type === "IDENTIFIER" ||
        this.peek().type === "TYPEDEF_NAME") &&
      this.peek(1).value === ":"
    ) {
      const label = this.advance();
      this.expect(":");
      this.declareLabel(label.value);
      const statement = this.parseStatement();
      return this.node("LabeledStatement", {
        label: label.value,
        statement,
      });
    }
    /*
     * BrowC __js__(...)
     */
    if (this.atType("JS_KEYWORD")) {
      return this.parseJSStatement();
    }
    /*
     * expression
     */
    const expression = this.parseExpression();
    this.expect(";");
    return this.node("ExpressionStatement", {
      expression,
    });
  }
  parseJSStatement() {
    const keyword = this.advance();
    this.expect("(");
    const argumentsList = [];
    if (!this.at(")")) {
      argumentsList.push(this.parseAssignmentExpression());
      while (this.match(",")) {
        argumentsList.push(this.parseAssignmentExpression());
      }
    }
    this.expect(")");
    this.expect(";");
    return this.node("BrowCJSStatement", {
      keyword: keyword.value,
      arguments: argumentsList,
    });
  }
  /* ========================================================
   * EXPRESSIONS
   * ========================================================
   */
  parseExpression() {
    const expressions = [];
    expressions.push(this.parseAssignmentExpression());
    while (this.match(",")) {
      expressions.push(this.parseAssignmentExpression());
    }
    if (expressions.length === 1) {
      return expressions[0];
    }
    return this.node("CommaExpression", {
      expressions,
    });
  }
  parseAssignmentExpression() {
    const left = this.parseConditionalExpression();
    if (BrowCParser.ASSIGNMENT_OPERATORS.has(this.peek().value)) {
      const operator = this.advance().value;
      const right = this.parseAssignmentExpression();
      return this.node("AssignmentExpression", {
        operator,
        left,
        right,
      });
    }
    return left;
  }
  parseConditionalExpression() {
    const condition = this.parseBinaryExpression(1);
    if (!this.match("?")) {
      return condition;
    }
    const thenExpression = this.parseExpression();
    this.expect(":");
    const elseExpression = this.parseConditionalExpression();
    return this.node("ConditionalExpression", {
      condition,
      thenExpression,
      elseExpression,
    });
  }
  parseBinaryExpression(minPrecedence) {
    let left = this.parseCastExpression();
    while (true) {
      const operator = this.peek().value;
      const precedence = this.getBinaryPrecedence(operator);
      if (precedence < minPrecedence) {
        break;
      }
      this.advance();
      const right = this.parseBinaryExpression(precedence + 1);
      left = this.node("BinaryExpression", {
        operator,
        left,
        right,
      });
    }
    return left;
  }
  getBinaryPrecedence(operator) {
    switch (operator) {
      case "||":
        return 1;
      case "&&":
        return 2;
      case "|":
        return 3;
      case "^":
        return 4;
      case "&":
        return 5;
      case "==":
      case "!=":
        return 6;
      case "<":
      case ">":
      case "<=":
      case ">=":
        return 7;
      case "<<":
      case ">>":
        return 8;
      case "+":
      case "-":
        return 9;
      case "*":
      case "/":
      case "%":
        return 10;
      default:
        return -1;
    }
  }
  parseCastExpression() {
    /*
     * cast:
     *
     * (type-name) expression
     */
    if (this.at("(") && this.looksLikeTypeNameAfterParen()) {
      this.expect("(");
      const type = this.parseTypeName();
      this.expect(")");
      const expression = this.parseCastExpression();
      return this.node("CastExpression", {
        /*
         * Named `targetType`, not `type` - `type` is reserved for the
         * node's own AST tag ("CastExpression"); see the comment in
         * node() for what went wrong when a prop was also called `type`.
         */
        targetType: type,
        expression,
      });
    }
    return this.parseUnaryExpression();
  }
  looksLikeTypeNameAfterParen() {
    const token = this.peek(1);
    if (this.isTypeSpecifier(token)) {
      return true;
    }
    if (token.type === "TYPEDEF_NAME") {
      return true;
    }
    if (BrowCParser.TYPE_QUALIFIERS.has(token.value)) {
      return true;
    }
    return false;
  }
  parseUnaryExpression() {
    const token = this.peek();
    /*
     * prefix operators
     */
    if (BrowCParser.PREFIX_OPERATORS.has(token.value)) {
      this.advance();
      const argument = this.parseCastExpression();
      return this.node("UnaryExpression", {
        operator: token.value,
        argument,
        prefix: true,
      });
    }
    /*
     * sizeof / _Alignof
     */
    if (token.value === "sizeof" || token.value === "_Alignof") {
      this.advance();
      if (this.at("(") && this.looksLikeTypeNameAfterParen()) {
        this.expect("(");
        const type = this.parseTypeName();
        this.expect(")");
        return this.node("TypeUnaryExpression", {
          operator: token.value,
          /* see the note in the CastExpression branch above */
          targetType: type,
        });
      }
      const argument = this.parseUnaryExpression();
      return this.node("UnaryExpression", {
        operator: token.value,
        argument,
        prefix: true,
      });
    }
    return this.parsePostfixExpression();
  }
  parsePostfixExpression() {
    let expression = this.parsePrimaryExpression();
    while (true) {
      /*
       * array subscript
       */
      if (this.match("[")) {
        const index = this.parseExpression();
        this.expect("]");
        expression = this.node("ArraySubscriptExpression", {
          object: expression,
          index,
        });
        continue;
      }
      /*
       * function call
       */
      if (this.match("(")) {
        const argumentsList = [];
        if (!this.at(")")) {
          argumentsList.push(this.parseAssignmentExpression());
          while (this.match(",")) {
            argumentsList.push(this.parseAssignmentExpression());
          }
        }
        this.expect(")");
        expression = this.node("CallExpression", {
          callee: expression,
          arguments: argumentsList,
        });
        continue;
      }
      /*
       * member access
       */
      if (this.match(".")) {
        const member = this.expectIdentifier("expected member name after '.'");
        expression = this.node("MemberExpression", {
          object: expression,
          member: member.value,
          throughPointer: false,
        });
        continue;
      }
      /*
       * pointer member access
       */
      if (this.match("->")) {
        const member = this.expectIdentifier("expected member name after '->'");
        expression = this.node("MemberExpression", {
          object: expression,
          member: member.value,
          throughPointer: true,
        });
        continue;
      }
      /*
       * postfix ++ / --
       */
      if (this.at("++") || this.at("--")) {
        const operator = this.advance().value;
        expression = this.node("UnaryExpression", {
          operator,
          argument: expression,
          prefix: false,
        });
        continue;
      }
      break;
    }
    return expression;
  }
  parsePrimaryExpression() {
    const token = this.peek();
    /*
     * integer / floating constant
     *
     * The lexer tags these "INTEGER_CONSTANT" / "FLOAT_CONSTANT" (not
     * "NUMBER" - there is no "NUMBER" token type anywhere in this lexer).
     */
    if (token.type === "INTEGER_CONSTANT" || token.type === "FLOAT_CONSTANT") {
      this.advance();
      return this.node("NumericLiteral", {
        value: token.value,
        isFloat: token.type === "FLOAT_CONSTANT",
      });
    }
    /*
     * character literal
     *
     * The lexer tags these "CHARACTER_CONSTANT" (not "CHAR").
     */
    if (token.type === "CHARACTER_CONSTANT") {
      this.advance();
      return this.node("CharacterLiteral", {
        value: token.value,
      });
    }
    /*
     * string literal
     *
     * Adjacent C string literals are concatenated by the
     * language translation process.
     */
    if (token.type === "STRING_LITERAL") {
      /*
       * emitString(node.parts) in the compiler expects an array of RAW
       * (undecoded) literal pieces - it runs decodeStringLiteral() on each
       * piece itself before joining. Collecting a single pre-joined
       * `.value` here (as an earlier version of this method did) meant
       * emitString always received `undefined`, defaulted to [], and
       * every string literal compiled down to an empty "" - printf's
       * format string included.
       */
      const parts = [];
      while (this.atType("STRING_LITERAL")) {
        parts.push(this.advance().value);
      }
      return this.node("StringLiteral", {
        parts,
      });
    }
    /*
     * identifier
     */
    if (token.type === "IDENTIFIER" || token.type === "TYPEDEF_NAME") {
      this.advance();
      return this.node("Identifier", {
        name: token.value,
      });
    }
    /*
     * __js__(...)
     *
     * BrowC allows it as an expression.
     */
    if (token.type === "JS_KEYWORD") {
      this.advance();
      this.expect("(");
      const argumentsList = [];
      if (!this.at(")")) {
        argumentsList.push(this.parseAssignmentExpression());
        while (this.match(",")) {
          argumentsList.push(this.parseAssignmentExpression());
        }
      }
      this.expect(")");
      return this.node("BrowCJSExpression", {
        arguments: argumentsList,
      });
    }
    /*
     * parenthesized expression
     */
    if (this.match("(")) {
      const expression = this.parseExpression();
      this.expect(")");
      return this.node("ParenthesizedExpression", {
        expression,
      });
    }
    throw new BrowCParseError(
      `expected expression, found '${token.value}'`,
      token,
      this.source
    );
  }
  /* ========================================================
   * TYPE NAMES
   * ========================================================
   */
  parseTypeName() {
    const specifiers = this.parseDeclarationSpecifiers();
    let declarator = null;
    if (this.canStartAbstractDeclarator()) {
      declarator = this.parseDeclarator(true);
    }
    return this.node("TypeName", {
      specifiers,
      declarator,
    });
  }
  canStartAbstractDeclarator() {
    return this.at("*") || this.at("(") || this.at("[");
  }
  /* ========================================================
   * COMPOUND LITERALS
   * ========================================================
   */
  parseCompoundLiteral() {
    this.expect("(");
    const type = this.parseTypeName();
    this.expect(")");
    const initializer = this.parseInitializer();
    return this.node("CompoundLiteral", {
      type,
      initializer,
    });
  }
  /* ========================================================
   * CONSTANT EXPRESSIONS
   * ========================================================
   */
  parseConstantExpression() {
    return this.parseConditionalExpression();
  }
  /* ========================================================
   * STATIC ASSERT
   * ========================================================
   */
  parseStaticAssertDeclaration() {
    this.expect("_Static_assert");
    this.expect("(");
    const expression = this.parseConstantExpression();
    this.expect(",");
    const messageParts = [];
    while (this.atType("STRING")) {
      messageParts.push(this.advance().value);
    }
    this.expect(")");
    this.expect(";");
    return this.node("StaticAssertDeclaration", {
      expression,
      message: messageParts,
    });
  }
  /* ========================================================
   * TYPE / DECLARATOR HELPERS
   * ========================================================
   */
  declaratorIsFunction(declarator) {
    if (!declarator) {
      return false;
    }
    if (declarator.type === "FunctionDeclarator") {
      return true;
    }
    if (declarator.declarator) {
      return this.declaratorIsFunction(declarator.declarator);
    }
    return false;
  }
  extractDeclaratorName(declarator) {
    if (!declarator) {
      return null;
    }
    if (declarator.type === "IdentifierDeclarator") {
      return declarator.name;
    }
    /*
     * "Declarator" nodes (produced by parseDeclarator) wrap a direct
     * declarator under `.direct` and also cache the resolved name on
     * `.name` directly - prefer that, then recurse into `.direct`.
     */
    if (typeof declarator.name === "string" && declarator.name) {
      return declarator.name;
    }
    if (declarator.direct) {
      return this.extractDeclaratorName(declarator.direct);
    }
    if (declarator.declarator) {
      return this.extractDeclaratorName(declarator.declarator);
    }
    return null;
  }
  registerDeclarationNames(specifiers, declarators) {
    let isTypedef = false;
    for (const specifier of specifiers) {
      if (
        specifier.type === "StorageClassSpecifier" &&
        specifier.value === "typedef"
      ) {
        isTypedef = true;
      }
    }
    for (const item of declarators) {
      const name = this.extractDeclaratorName(item.declarator);
      if (!name) {
        continue;
      }
      if (isTypedef) {
        this.declareTypedef(name);
      } else {
        this.declareOrdinary(name);
      }
    }
  }
  /* ========================================================
   * NODE / DEBUG UTILITIES
   * ========================================================
   */
  location(token) {
    return {
      filename: token.filename,
      line: token.line,
      column: token.column,
    };
  }
}
/* ============================================================
 * PUBLIC HELPER
 * ============================================================
 */
function parseBrowC(source, options = {}) {
  const parser = new BrowCParser(source, options);
  return parser.parse();
}
/* ============================================================
 * BROWSER EXPORT
 * ============================================================
 */
if (typeof globalThis !== "undefined") {
  globalThis.BrowCParser = BrowCParser;
  globalThis.BrowCParseError = BrowCParseError;
  globalThis.BrowCToken = BrowCToken;
  globalThis.parseBrowC = parseBrowC;
}
/* ============================================================
 * NODE EXPORT
 * ============================================================
 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BrowCParser,
    BrowCParseError,
    BrowCToken,
    parseBrowC,
  };
}
/*
 * browc-ast.js
 *
 * BrowC AST -> JavaScript compiler
 *
 * Pipeline:
 *
 *   BrowC AST
 *       |
 *       v
 *   BrowCCompiler
 *       |
 *       v
 *   JavaScript source
 *
 * The generated JavaScript is designed to run inside
 * BrowCRuntime.
 */ ("use strict");
/* ============================================================
 * Errors
 * ============================================================ */ class BrowCCompileError extends Error {
  constructor(message, node = null) {
    super(message);
    this.name = "BrowCCompileError";
    this.node = node;
    if (node && node.location) {
      this.message +=
        ` (${node.location.filename}:` +
        `${node.location.line}:` +
        `${node.location.column})`;
    }
  }
}
/* ============================================================
 * JavaScript writer
 * ============================================================ */ class BrowCJSWriter {
  constructor() {
    this.parts = [];
    this.indentLevel = 0;
  }
  indent() {
    this.indentLevel++;
  }
  dedent() {
    if (this.indentLevel > 0) {
      this.indentLevel--;
    }
  }
  write(text = "") {
    this.parts.push(text);
  }
  line(text = "") {
    this.parts.push("  ".repeat(this.indentLevel) + text + "\n");
  }
  toString() {
    return this.parts.join("");
  }
}
/* ============================================================
 * AST -> JS compiler
 * ============================================================ */ class BrowCASTToJS {
  constructor(options = {}) {
    this.options = {
      runtimeName: options.runtimeName || "__browc",
      sourceMap: options.sourceMap !== false,
      strict: options.strict !== false,
      emitComments: options.emitComments !== false,
    };
    this.writer = new BrowCJSWriter();
    this.functions = new Map();
    this.globalVariables = new Set();
    this.currentFunction = null;
    this.tempCounter = 0;
    this.loopDepth = 0;
  }
  /* ==========================================================
   * Public API
   * ========================================================== */ compile(
    ast
  ) {
    if (!ast || ast.type !== "TranslationUnit") {
      throw new BrowCCompileError("expected TranslationUnit AST");
    }
    this.writer = new BrowCJSWriter();
    if (this.options.strict) {
      this.writer.line('"use strict";');
      this.writer.line("");
    }
    this.writer.line(`const __browc = globalThis.BrowCRuntime;`);
    this.writer.line("");
    /*
     * First pass:
     *
     * collect functions.
     */
    for (const declaration of ast.declarations || []) {
      if (declaration && declaration.type === "FunctionDefinition") {
        const name = this.getDeclaratorName(declaration.declarator);
        if (name) {
          this.functions.set(name, declaration);
        }
      }
    }
    /*
     * Second pass:
     *
     * emit globals/functions.
     */
    for (const declaration of ast.declarations || []) {
      this.emitTopLevel(declaration);
    }
    this.writer.line("");
    /*
     * C program entry point.
     */
    this.writer.line(`if (typeof main === "function") {`);
    this.writer.indent();
    this.writer.line(`__browc.runMain(main);`);
    this.writer.dedent();
    this.writer.line("}");
    return this.writer.toString();
  }
  /* ==========================================================
   * Top level
   * ========================================================== */ emitTopLevel(
    node
  ) {
    if (!node) {
      return;
    }
    switch (node.type) {
      case "FunctionDefinition":
        this.emitFunction(node);
        break;
      case "Declaration":
        this.emitGlobalDeclaration(node);
        break;
      case "Comment":
        if (this.options.emitComments) {
          this.writer.line(node.text);
        }
        break;
      case "PreprocessorDirective":
        /*
         * Normally preprocessing has already handled these.
         */
        break;
      case "StaticAssertDeclaration":
        this.emitStaticAssert(node);
        break;
      default:
        /*
         * Unknown top-level constructs are deliberately rejected
         * instead of silently generating incorrect JavaScript.
         */
        throw new BrowCCompileError(
          `unsupported top-level AST node '${node.type}'`,
          node
        );
    }
  }
  /* ==========================================================
   * Functions
   * ========================================================== */ emitFunction(
    node
  ) {
    const name = this.getDeclaratorName(node.declarator);
    if (!name) {
      throw new BrowCCompileError("function has no name", node);
    }
    this.currentFunction = name;
    const functionDeclarator = this.findFunctionDeclarator(node.declarator);
    const parameters = functionDeclarator?.parameters || [];
    const parameterNames = [];
    for (const parameter of parameters) {
      const parameterName = this.getDeclaratorName(parameter.declarator);
      if (parameterName) {
        parameterNames.push(parameterName);
      }
    }
    this.writer.line(
      `function ${this.safeIdentifier(name)}(` +
        `${parameterNames.map((x) => this.safeIdentifier(x)).join(", ")}` +
        `) {`
    );
    this.writer.indent();
    /*
     * Every BrowC function gets access to runtime facilities.
     */
    this.writer.line(`const __ctx = __browc.currentContext();`);
    /*
     * BrowC parameters are normal JS parameters.
     */
    this.emitStatement(node.body);
    this.writer.dedent();
    this.writer.line("}");
    this.writer.line("");
    this.currentFunction = null;
  }
  /* ==========================================================
   * Globals
   * ========================================================== */ emitGlobalDeclaration(
    node
  ) {
    const specifiers = node.specifiers || [];
    const isTypedef = specifiers.some(
      (s) => s.type === "StorageClassSpecifier" && s.value === "typedef"
    );
    const isExtern = specifiers.some(
      (s) => s.type === "StorageClassSpecifier" && s.value === "extern"
    );
    /*
     * `typedef ...;` introduces a compile-time-only type alias - it has no
     * runtime representation and must not emit a JS binding at all.
     */
    if (isTypedef) {
      return;
    }
    for (const declarator of node.declarators || []) {
      const name = this.getDeclaratorName(declarator.declarator);
      if (!name) {
        continue;
      }
      this.globalVariables.add(name);
      if (this.isFunctionDeclarator(declarator.declarator)) {
        continue;
      }
      /*
       * `extern <type> name;` with no initializer is a reference to a
       * symbol defined elsewhere (typically one of the stdio FILE handles
       * or another runtime-provided global bound onto globalThis by
       * installBrowCBuiltins()). Emitting `let name = undefined;` here
       * would shadow that real binding inside this function's/module's
       * scope, so any use of the name would silently see `undefined`
       * instead of the real value. Only emit a binding when there is
       * either an initializer or this isn't an `extern` declaration.
       */
      if (isExtern && !declarator.initializer) {
        continue;
      }
      const initializer = declarator.initializer
        ? this.emitExpression(declarator.initializer)
        : this.defaultValue(node.specifiers, declarator.declarator);
      this.writer.line(`let ${this.safeIdentifier(name)} = ${initializer};`);
    }
  }
  /* ==========================================================
   * Statements
   * ========================================================== */ emitStatement(
    node
  ) {
    if (!node) {
      return;
    }
    switch (node.type) {
      case "CompoundStatement":
        this.emitCompound(node);
        break;
      case "Declaration":
        this.emitDeclaration(node);
        break;
      case "ExpressionStatement":
        this.writer.line(`${this.emitExpression(node.expression)};`);
        break;
      case "ReturnStatement":
        if (node.expression) {
          this.writer.line(`return ${this.emitExpression(node.expression)};`);
        } else {
          this.writer.line("return;");
        }
        break;
      case "IfStatement":
        this.emitIf(node);
        break;
      case "WhileStatement":
        this.emitWhile(node);
        break;
      case "DoWhileStatement":
        this.emitDoWhile(node);
        break;
      case "ForStatement":
        this.emitFor(node);
        break;
      case "BreakStatement":
        this.writer.line("break;");
        break;
      case "ContinueStatement":
        this.writer.line("continue;");
        break;
      case "NullStatement":
        this.writer.line(";");
        break;
      case "Expression":
        this.writer.line(`${this.emitExpression(node)};`);
        break;
      case "BrowCJSStatement":
        this.emitJSStatement(node);
        break;
      case "LabeledStatement":
        this.writer.line(`${this.safeIdentifier(node.label)}:`);
        this.emitStatement(node.statement);
        break;
      case "GotoStatement":
        /*
         * Real C goto cannot simply be translated to JavaScript
         * goto because JavaScript has no goto statement.
         */
        throw new BrowCCompileError(
          "goto is not yet supported by the BrowC JavaScript backend",
          node
        );
      case "SwitchStatement":
        this.emitSwitch(node);
        break;
      case "CaseStatement":
        /*
         * Grammatically `case expr: statement` only binds one following
         * statement, but real switch bodies are a flat statement list
         * with case/default acting as labels within it (that's exactly
         * how C's switch fall-through works) - so emitting the JS label
         * followed by that one wrapped statement, inline, reproduces the
         * same flat structure and the same fall-through behavior. This
         * was previously entirely unhandled ("unsupported statement
         * 'CaseStatement'"), so no `switch` with case labels could
         * compile at all.
         */
        this.writer.line(`case ${this.emitExpression(node.expression)}:`);
        this.emitStatement(node.statement);
        break;
      case "DefaultStatement":
        this.writer.line("default:");
        this.emitStatement(node.statement);
        break;
      case "Comment":
        if (this.options.emitComments) {
          this.writer.line(node.text);
        }
        break;
      case "PreprocessorDirective":
        break;
      default:
        throw new BrowCCompileError(
          `unsupported statement '${node.type}'`,
          node
        );
    }
  }
  emitCompound(node) {
    this.writer.line("{");
    this.writer.indent();
    for (const statement of node.body || []) {
      this.emitStatement(statement);
    }
    this.writer.dedent();
    this.writer.line("}");
  }
  emitDeclaration(node) {
    const specifiers = node.specifiers || [];
    const isTypedef = specifiers.some(
      (s) => s.type === "StorageClassSpecifier" && s.value === "typedef"
    );
    const isExtern = specifiers.some(
      (s) => s.type === "StorageClassSpecifier" && s.value === "extern"
    );
    /*
     * `typedef ...;` is a compile-time-only type alias with no runtime
     * representation (see emitGlobalDeclaration for the same rule at
     * file scope).
     */
    if (isTypedef) {
      return;
    }
    for (const declarator of node.declarators || []) {
      const name = this.getDeclaratorName(declarator.declarator);
      if (!name) {
        continue;
      }
      /*
       * Functions are not local variable declarations.
       */
      if (this.isFunctionDeclarator(declarator.declarator)) {
        continue;
      }
      /*
       * A local `extern <type> name;` with no initializer refers to a
       * symbol defined elsewhere and must not shadow it with a fresh
       * `undefined` local binding (see emitGlobalDeclaration).
       */
      if (isExtern && !declarator.initializer) {
        continue;
      }
      let value;
      if (declarator.initializer) {
        value = this.emitExpression(declarator.initializer);
      } else {
        value = this.defaultValue(node.specifiers, declarator.declarator);
      }
      this.writer.line(`let ${this.safeIdentifier(name)} = ${value};`);
    }
  }
  emitIf(node) {
    this.writer.line(`if (${this.emitExpression(node.condition)}) {`);
    this.writer.indent();
    this.emitStatementBody(node.thenBranch);
    this.writer.dedent();
    this.writer.line("}");
    if (node.elseBranch) {
      this.writer.line("else {");
      this.writer.indent();
      this.emitStatementBody(node.elseBranch);
      this.writer.dedent();
      this.writer.line("}");
    }
  }
  emitStatementBody(node) {
    if (node.type === "CompoundStatement") {
      for (const statement of node.body || []) {
        this.emitStatement(statement);
      }
    } else {
      this.emitStatement(node);
    }
  }
  emitWhile(node) {
    this.writer.line(`while (${this.emitExpression(node.condition)}) {`);
    this.loopDepth++;
    this.writer.indent();
    this.emitStatementBody(node.body);
    this.writer.dedent();
    this.loopDepth--;
    this.writer.line("}");
  }
  emitDoWhile(node) {
    this.writer.line("do {");
    this.loopDepth++;
    this.writer.indent();
    this.emitStatementBody(node.body);
    this.writer.dedent();
    this.loopDepth--;
    this.writer.line(`} while (${this.emitExpression(node.condition)});`);
  }
  emitFor(node) {
    let init = "";
    if (node.init) {
      if (node.init.type === "Declaration") {
        init = this.inlineDeclaration(node.init);
      } else {
        init = this.emitExpression(node.init);
      }
    }
    const condition = node.condition ? this.emitExpression(node.condition) : "";
    const iteration = node.iteration ? this.emitExpression(node.iteration) : "";
    this.writer.line(`for (${init}; ${condition}; ${iteration}) {`);
    this.loopDepth++;
    this.writer.indent();
    this.emitStatementBody(node.body);
    this.writer.dedent();
    this.loopDepth--;
    this.writer.line("}");
  }
  inlineDeclaration(node) {
    const parts = [];
    for (const declarator of node.declarators || []) {
      const name = this.getDeclaratorName(declarator.declarator);
      if (!name) {
        continue;
      }
      let value = this.defaultValue(node.specifiers, declarator.declarator);
      if (declarator.initializer) {
        value = this.emitExpression(declarator.initializer);
      }
      parts.push(`let ${this.safeIdentifier(name)} = ${value}`);
    }
    return parts.join(", ");
  }
  emitSwitch(node) {
    this.writer.line(`switch (${this.emitExpression(node.expression)}) {`);
    this.writer.indent();
    /*
     * The switch body is a CompoundStatement, but its case/default labels
     * must sit directly inside the JS `switch (...) { ... }` block, not
     * nested inside a further `{ }` - delegating to emitStatement(node.
     * body) went through emitCompound(), which always wraps its output in
     * its own brace pair, producing `switch (x) { { case 1: ... } }`,
     * which is a JS syntax error (case labels aren't valid directly
     * inside a plain block). Emit the compound's inner statements
     * directly instead, the same way a C compiler treats a switch body
     * as one flat, label-interspersed statement list.
     */
    if (node.body && node.body.type === "CompoundStatement") {
      for (const statement of node.body.body || []) {
        this.emitStatement(statement);
      }
    } else {
      this.emitStatement(node.body);
    }
    this.writer.dedent();
    this.writer.line("}");
  }
  emitStaticAssert(node) {
    this.writer.line(`if (!(${this.emitExpression(node.expression)})) {`);
    this.writer.indent();
    const message = (node.message || [])
      .map((x) => this.decodeStringLiteral(x))
      .join("");
    this.writer.line(
      `throw new Error(${JSON.stringify(
        message || "BrowC static assertion failed"
      )});`
    );
    this.writer.dedent();
    this.writer.line("}");
  }
  /* ==========================================================
   * BrowC __js__()
   * ========================================================== */ emitJSStatement(
    node
  ) {
    /*
     * __js__("console.log('hello')")
     *
     * becomes:
     *
     * __browc.executeJS("console.log('hello')");
     */ if (!node.arguments || node.arguments.length === 0) {
      this.writer.line(`__browc.executeJS("");`);
      return;
    }
    const code = this.emitExpression(node.arguments[0]);
    this.writer.line(`__browc.executeJS(${code});`);
  }
  /* ==========================================================
   * Expressions
   * ========================================================== */ emitExpression(
    node
  ) {
    if (!node) {
      return "undefined";
    }
    switch (node.type) {
      case "NumericLiteral":
        return this.emitNumber(node.value);
      case "CharacterLiteral":
        return this.emitCharacter(node.value);
      case "StringLiteral":
        return this.emitString(node.parts);
      case "Identifier":
        return this.safeIdentifier(node.name);
      case "ParenthesizedExpression":
        return `(${this.emitExpression(node.expression)})`;
      case "BinaryExpression":
        return (
          `(${this.emitExpression(node.left)} ` +
          `${node.operator} ` +
          `${this.emitExpression(node.right)})`
        );
      case "AssignmentExpression": {
        /*
         * `*ptr = value` (and `*ptr += value`, etc.) needs to go through
         * derefAssign() - emitting the naive `${lhs} ${op} ${rhs}` here
         * produced the literal, invalid JS `__browc.deref(ptr) = value`
         * (a call expression can't be an assignment target), which threw
         * "Invalid left-hand side in assignment" before the compiled
         * program ever ran.
         */
        if (
          node.left.type === "UnaryExpression" &&
          node.left.operator === "*"
        ) {
          const pointerExpr = this.emitExpression(node.left.argument);
          const rhsExpr = this.emitExpression(node.right);
          if (node.operator === "=") {
            return `__browc.derefAssign(${pointerExpr}, ${rhsExpr})`;
          }
          /*
           * Compound assignment through a pointer (*p += 1, *p *= 2, ...):
           * read the current value once via deref(), apply the operator,
           * then write the result back via derefAssign(). The binary
           * operator is the assignment operator with the trailing "="
           * removed (e.g. "+=" -> "+").
           */
          const binaryOp = node.operator.slice(0, -1);
          return (
            `__browc.derefAssign(${pointerExpr}, ` +
            `(__browc.deref(${pointerExpr}) ${binaryOp} ${rhsExpr}))`
          );
        }
        return (
          `(${this.emitExpression(node.left)} ` +
          `${node.operator} ` +
          `${this.emitExpression(node.right)})`
        );
      }
      case "UnaryExpression":
        return this.emitUnary(node);
      case "CallExpression":
        return this.emitCall(node);
      case "MemberExpression":
        return (
          `${this.emitExpression(node.object)}` +
          `.${this.safeIdentifier(node.member)}`
        );
      case "ArraySubscriptExpression":
        return (
          `${this.emitExpression(node.object)}` +
          `[${this.emitExpression(node.index)}]`
        );
      case "ConditionalExpression":
        return (
          `(${this.emitExpression(node.condition)} ? ` +
          `${this.emitExpression(node.thenExpression)} : ` +
          `${this.emitExpression(node.elseExpression)})`
        );
      case "CommaExpression":
        return `(${node.expressions
          .map((x) => this.emitExpression(x))
          .join(", ")})`;
      case "CastExpression":
        return this.emitCast(node);
      case "TypeUnaryExpression":
        return this.emitTypeUnary(node);
      case "BrowCJSExpression":
        return this.emitJSExpression(node);
      case "CompoundLiteral":
        return this.emitInitializer(node.initializer);
      default:
        throw new BrowCCompileError(
          `unsupported expression '${node.type}'`,
          node
        );
    }
  }
  emitNumber(value) {
    const text = String(value);
    /*
     * Remove C integer suffixes.
     */
    if (
      /^[0-9]/.test(text) ||
      text.startsWith(".") ||
      text.startsWith("0x") ||
      text.startsWith("0X")
    ) {
      const cleaned = text.replace(/[uUlLfF]+$/g, "");
      if (/^0[bB][01]+$/.test(cleaned)) {
        return `0b${cleaned.slice(2)}`;
      }
      return cleaned;
    }
    return text;
  }
  emitCharacter(value) {
    /*
     * C character constants become JS strings/numeric values.
     *
     * For normal C:
     *
     *   'A' -> 65
     */
    const decoded = this.decodeCharacterLiteral(value);
    return String(decoded.charCodeAt(0));
  }
  emitString(parts) {
    const text = (parts || []).map((x) => this.decodeStringLiteral(x)).join("");
    return JSON.stringify(text);
  }
  emitUnary(node) {
    const argument = this.emitExpression(node.argument);
    switch (node.operator) {
      case "++":
        return node.prefix ? `(++${argument})` : `(${argument}++)`;
      case "--":
        return node.prefix ? `(--${argument})` : `(${argument}--)`;
      case "+":
      case "-":
      case "~":
      case "!":
        return `(${node.operator}${argument})`;
      case "&": {
        /*
         * addressOf(getter, setter) needs a setter too, not just a
         * getter - without one, `int *p = &x; *p = 5;` had no way to
         * write back to `x` (addressOf's setter defaults to null, and
         * calling .set() on a null setter throws "cannot assign through
         * read-only reference"). Any lvalue this compiler can also emit
         * as a plain assignment target (a bare identifier, a struct
         * member, or an array element) gets a real setter; anything else
         * (e.g. &*p, or the address of a non-lvalue) stays read-only,
         * matching the previous behavior.
         */
        const isAssignableTarget =
          node.argument &&
          (node.argument.type === "Identifier" ||
            node.argument.type === "MemberExpression" ||
            node.argument.type === "ArraySubscriptExpression");
        const setter = isAssignableTarget
          ? `, (__v) => (${argument} = __v)`
          : "";
        return `__browc.addressOf(() => ${argument}${setter})`;
      }
      case "*":
        return `__browc.deref(${argument})`;
      case "sizeof":
        return `__browc.sizeof(${argument})`;
      default:
        throw new BrowCCompileError(
          `unsupported unary operator '${node.operator}'`,
          node
        );
    }
  }
  emitCall(node) {
    const callee = this.emitExpression(node.callee);
    const args = (node.arguments || [])
      .map((x) => this.emitExpression(x))
      .join(", ");
    return `${callee}(${args})`;
  }
  emitCast(node) {
    /*
     * JavaScript itself has no C casts.
     *
     * BrowC runtime performs the conversion.
     */
    return (
      `__browc.cast(` +
      `${this.typeDescription(node.targetType)}, ` +
      `${this.emitExpression(node.expression)}` +
      `)`
    );
  }
  emitTypeUnary(node) {
    if (node.operator === "sizeof") {
      return `__browc.sizeofType(${this.typeDescription(node.targetType)})`;
    }
    if (node.operator === "_Alignof") {
      return `__browc.alignof(${this.typeDescription(node.targetType)})`;
    }
    throw new BrowCCompileError(
      `unsupported type unary operator '${node.operator}'`,
      node
    );
  }
  emitJSExpression(node) {
    if (!node.arguments || node.arguments.length === 0) {
      return "undefined";
    }
    /*
     * __js__("expression")
     */
    return (
      `__browc.evaluateJS(` + `${this.emitExpression(node.arguments[0])}` + `)`
    );
  }
  emitInitializer(node) {
    if (!node) {
      return "undefined";
    }
    switch (node.type) {
      case "InitializerList":
        return `[${node.items
          .map((item) => this.emitExpression(item.initializer))
          .join(", ")}]`;
      default:
        return this.emitExpression(node);
    }
  }
  /* ==========================================================
   * Type information
   * ========================================================== */ typeDescription(
    type
  ) {
    if (!type) {
      return JSON.stringify({
        kind: "unknown",
      });
    }
    if (type.type === "TypeName") {
      return JSON.stringify({
        kind: "type",
        specifiers: (type.specifiers || []).map((x) => x.value || x.type),
      });
    }
    return JSON.stringify({
      kind: "unknown",
    });
  }
  /*
   * Same recursive-wrapper shape as findFunctionDeclarator, but looking for
   * an ArrayDeclarator instead - used so `defaultValue()` can tell that
   * `int arr[5];` needs a real 5-element array, not the scalar default "0"
   * (previously `arr` initialized to `undefined`/`0`, so `arr[i] = ...`
   * failed at runtime with "Cannot set properties of undefined").
   */
  findArrayDeclarator(node) {
    if (!node) {
      return null;
    }
    if (node.type === "ArrayDeclarator") {
      return node;
    }
    if (node.direct) {
      return this.findArrayDeclarator(node.direct);
    }
    if (node.declarator) {
      return this.findArrayDeclarator(node.declarator);
    }
    return null;
  }
  isStructOrUnionType(specifiers = []) {
    /*
     * Deliberately narrow: only a direct `struct`/`union` specifier is
     * recognized here. A typedef'd struct (`typedef struct {...} Point;
     * Point p;`) can't be resolved to "this is a struct" without a real
     * type table keyed by typedef name, which this compiler doesn't
     * maintain - such declarations still default to "undefined" rather
     * than risk defaulting an unrelated typedef'd scalar (e.g. `size_t`)
     * to an object.
     */
    return specifiers.some((s) => s.type === "StructOrUnionSpecifier");
  }
  defaultValue(specifiers = [], declarator = null) {
    /*
     * Array declarators take priority over the base-type default: an
     * array's runtime value must be a real JS array of the right length,
     * not whatever scalar/struct default its element type would use on
     * its own.
     */
    const arrayDeclarator = declarator
      ? this.findArrayDeclarator(declarator)
      : null;
    if (arrayDeclarator) {
      const elementDefault = this.defaultValue(
        specifiers,
        arrayDeclarator.declarator
      );
      if (arrayDeclarator.size) {
        const sizeExpr = this.emitExpression(arrayDeclarator.size);
        return `Array.from({ length: (${sizeExpr}) }, () => (${elementDefault}))`;
      }
      /*
       * Incomplete array type (`int arr[];`) or a VLA whose size we can't
       * pre-materialize here - fall back to an empty, growable array.
       */
      return `[]`;
    }
    const names = specifiers.map((x) => x.value || x.name).filter(Boolean);
    if (names.includes("void")) {
      return "undefined";
    }
    if (names.includes("float") || names.includes("double")) {
      return "0";
    }
    if (
      names.includes("char") ||
      names.includes("int") ||
      names.includes("short") ||
      names.includes("long") ||
      names.includes("signed") ||
      names.includes("unsigned") ||
      names.includes("_Bool")
    ) {
      return "0";
    }
    /*
     * `struct Point p;` (or a typedef'd struct/union) needs a real object
     * so that later `p.x = ...` assignments have something to assign
     * onto - it previously defaulted to the string "undefined", so every
     * struct-typed local/global crashed on first field access with
     * "Cannot set properties of undefined".
     *
     * C99 does not zero-initialize automatic aggregates without an
     * explicit initializer (their members are indeterminate); this uses
     * an empty object rather than attempting to model that indeterminate
     * state, which is a deliberate simplification, not a claim of exact
     * C semantics.
     */
    if (this.isStructOrUnionType(specifiers)) {
      return "{}";
    }
    return "undefined";
  }
  /* ==========================================================
   * Declarators
   * ========================================================== */ getDeclaratorName(
    node
  ) {
    if (!node) {
      return null;
    }
    if (node.type === "IdentifierDeclarator") {
      return node.name;
    }
    /*
     * "Declarator" nodes wrap a direct declarator under `.direct` and also
     * cache the resolved name on `.name` directly (see BrowCParser's own
     * extractDeclaratorName, which has the identical shape) - prefer that,
     * then recurse into `.direct`, then fall back to `.declarator` for any
     * other wrapper shapes (e.g. parenthesized/abstract declarators).
     */
    if (typeof node.name === "string" && node.name) {
      return node.name;
    }
    if (node.direct) {
      return this.getDeclaratorName(node.direct);
    }
    if (node.declarator) {
      return this.getDeclaratorName(node.declarator);
    }
    return null;
  }
  findFunctionDeclarator(node) {
    if (!node) {
      return null;
    }
    if (node.type === "FunctionDeclarator") {
      return node;
    }
    /*
     * Same wrapper shape as getDeclaratorName above: the outer "Declarator"
     * node nests its inner declarator under `.direct`, not `.declarator`.
     * Without this, every function's parameter list was silently dropped
     * (parameters?.length always came back 0) because this always matched
     * the top-level "Declarator" wrapper and never found the
     * "FunctionDeclarator" underneath it.
     */
    if (node.direct) {
      return this.findFunctionDeclarator(node.direct);
    }
    if (node.declarator) {
      return this.findFunctionDeclarator(node.declarator);
    }
    return null;
  }
  isFunctionDeclarator(node) {
    return !!this.findFunctionDeclarator(node);
  }
  /* ==========================================================
   * JavaScript identifiers
   * ========================================================== */ safeIdentifier(
    name
  ) {
    /*
     * C identifiers are mostly legal JS identifiers.
     *
     * A few JavaScript reserved words need escaping.
     */
    const reserved = new Set([
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "debugger",
      "default",
      "delete",
      "do",
      "else",
      "export",
      "extends",
      "finally",
      "for",
      "function",
      "if",
      "import",
      "in",
      "instanceof",
      "let",
      "new",
      "return",
      "super",
      "switch",
      "this",
      "throw",
      "try",
      "typeof",
      "var",
      "void",
      "while",
      "with",
      "yield",
    ]);
    if (reserved.has(name)) {
      return `_${name}`;
    }
    return name;
  }
  /* ==========================================================
   * Literal decoding
   * ========================================================== */ decodeStringLiteral(
    value
  ) {
    let text = String(value);
    if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
      text = text.slice(1, -1);
    }
    return this.decodeEscapes(text);
  }
  decodeCharacterLiteral(value) {
    let text = String(value);
    if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
      text = text.slice(1, -1);
    }
    return this.decodeEscapes(text);
  }
  decodeEscapes(text) {
    return text
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\v/g, "\v")
      .replace(/\\b/g, "\b")
      .replace(/\\f/g, "\f")
      .replace(/\\a/g, "\x07")
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\0/g, "\0");
  }
}
/* ============================================================
 * Public helper
 * ============================================================ */ function compileBrowCAST(
  ast,
  options = {}
) {
  return new BrowCASTToJS(options).compile(ast);
}
/* ============================================================
 * Browser export
 * ============================================================ */ if (
  typeof globalThis !== "undefined"
) {
  globalThis.BrowCASTToJS = BrowCASTToJS;
  globalThis.BrowCCompileError = BrowCCompileError;
  globalThis.compileBrowCAST = compileBrowCAST;
}
/* ============================================================
 * Node export
 * ============================================================ */ if (
  typeof module !== "undefined" &&
  module.exports
) {
  module.exports = {
    BrowCASTToJS,
    BrowCCompileError,
    compileBrowCAST,
  };
}

/*
 * BrowC Runtime
 * ============
 *
 * ACTUAL executor/runtime for BrowC generated JavaScript.
 *
 * Architecture:
 *
 *   BrowC source
 *       |
 *       v
 *   Preprocessor
 *       |
 *       v
 *   Lexer
 *       |
 *       v
 *   Parser
 *       |
 *       v
 *   AST
 *       |
 *       v
 *   AST -> JS
 *       |
 *       v
 *   BrowCRuntime.execute()
 *       |
 *       v
 *   JavaScript execution
 *
 * No IndexedDB.
 *
 * BrowC files exist as DOM elements:
 *
 *   <browc-file filename="main.c">
 *       ...
 *   </browc-file>
 *
 *   <browc-file filename="stdio.h" content="..."></browc-file>
 *
 * The runtime provides:
 *
 *   - BrowC virtual filesystem
 *   - C-like memory
 *   - pointers
 *   - pointer arithmetic
 *   - typed memory
 *   - C strings
 *   - arrays
 *   - malloc/calloc/realloc/free
 *   - memcpy/memmove/memset/memcmp
 *   - strlen/strcmp/strcpy/strncpy/strcat/strchr
 *   - printf/puts/putchar/getchar
 *   - DOM API
 *   - timers/events
 *   - random numbers
 *   - JavaScript escape hatch
 *   - program lifecycle
 *   - execution of generated JS
 *
 * C99-oriented.
 *
 * Browser environment.
 */
("use strict");
/* 
  Hiding <browc-file> elements from the DOM so they don't clutter the page.
*/

let BROWC_FILE = document.querySelectorAll("browc-file");
BROWC_FILE.forEach((file) => {
  file.style.display = "none";
});
BROWC_FILE = undefined;

/* ============================================================
 * Errors
 * ============================================================ */
class BrowCRuntimeError extends Error {
  constructor(message, code = "RUNTIME_ERROR") {
    super(String(message));
    this.name = "BrowCRuntimeError";
    this.code = code;
  }
}
class BrowCMemoryError extends BrowCRuntimeError {
  constructor(message) {
    super(message, "MEMORY_ERROR");
    this.name = "BrowCMemoryError";
  }
}
class BrowCPointerError extends BrowCRuntimeError {
  constructor(message) {
    super(message, "POINTER_ERROR");
    this.name = "BrowCPointerError";
  }
}
class BrowCFileError extends BrowCRuntimeError {
  constructor(message) {
    super(message, "FILE_ERROR");
    this.name = "BrowCFileError";
  }
}
/* ============================================================
 * Utilities
 * ============================================================ */
function browcClampInteger(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.trunc(n);
}
function browcToUint8(value) {
  return Number(value) & 0xff;
}
function browcToInt8(value) {
  const v = Number(value) & 0xff;
  return v >= 0x80 ? v - 0x100 : v;
}
function browcToUint16(value) {
  return Number(value) & 0xffff;
}
function browcToInt16(value) {
  const v = Number(value) & 0xffff;
  return v >= 0x8000 ? v - 0x10000 : v;
}
function browcToUint32(value) {
  return Number(value) >>> 0;
}
function browcToInt32(value) {
  return Number(value) | 0;
}
function browcIsPointer(value) {
  return value && typeof value === "object" && value.__browc_pointer === true;
}
function browcIsMemoryBlock(value) {
  return (
    value && typeof value === "object" && value.__browc_memory_block === true
  );
}
/* ============================================================
 * BrowC Virtual File
 * ============================================================ */
class BrowCFile {
  constructor(filename, content = "", options = {}) {
    this.filename = String(filename);
    this.content = String(content ?? "");
    this.encoding = options.encoding || "utf-8";
    this.readOnly = options.readOnly === true;
    this.element = options.element || null;
  }
  read() {
    return this.content;
  }
  write(content) {
    if (this.readOnly) {
      throw new BrowCFileError(`file '${this.filename}' is read-only`);
    }
    this.content = String(content ?? "");
    this.syncElement();
    return this;
  }
  append(content) {
    return this.write(this.content + String(content ?? ""));
  }
  syncElement() {
    if (!this.element) {
      return;
    }
    /*
     * Do not continuously overwrite the content attribute
     * because that would make source files with quotes/newlines
     * awkward in the DOM.
     *
     * The element's text content is the authoritative source
     * representation after runtime registration.
     */
    if (this.element.hasAttribute("content")) {
      this.element.setAttribute("content", this.content);
    } else {
      this.element.textContent = this.content;
    }
  }
}
/* ============================================================
 * BrowC Virtual File System
 * ============================================================ */
class BrowCVirtualFileSystem {
  constructor(root = null) {
    this.root = root || (typeof document !== "undefined" ? document : null);
    this.files = new Map();
    if (this.root) {
      this.scan();
    }
  }
  normalize(filename) {
    let value = String(filename ?? "").trim();
    value = value.replace(/\\/g, "/");
    while (value.startsWith("./")) {
      value = value.slice(2);
    }
    value = value.replace(/\/+/g, "/");
    /*
     * Never allow an absolute filesystem path.
     * BrowC paths are virtual and rooted at the document.
     */
    value = value.replace(/^\/+/, "");
    const parts = [];
    for (const part of value.split("/")) {
      if (!part || part === ".") {
        continue;
      }
      if (part === "..") {
        if (parts.length > 0) {
          parts.pop();
        }
        continue;
      }
      parts.push(part);
    }
    return parts.join("/");
  }
  scan() {
    if (!this.root) {
      return;
    }
    const elements = this.root.querySelectorAll("browc-file");
    for (const element of elements) {
      const filename = element.getAttribute("filename");
      if (!filename) {
        throw new BrowCFileError("<browc-file> requires filename");
      }
      const contentAttribute = element.getAttribute("content");
      const content =
        contentAttribute !== null ? contentAttribute : element.textContent;
      this.set(filename, content || "", {
        element,
      });
    }
  }
  has(filename) {
    return this.files.has(this.normalize(filename));
  }
  get(filename) {
    const normalized = this.normalize(filename);
    return this.files.get(normalized) || null;
  }
  require(filename) {
    const file = this.get(filename);
    if (!file) {
      throw new BrowCFileError(`file not found: ${filename}`);
    }
    return file.content;
  }
  set(filename, content, options = {}) {
    const normalized = this.normalize(filename);
    const file = new BrowCFile(normalized, content, options);
    this.files.set(normalized, file);
    return file;
  }
  delete(filename) {
    return this.files.delete(this.normalize(filename));
  }
  list() {
    return [...this.files.keys()];
  }
  clear() {
    this.files.clear();
  }
  readFile(filename) {
    return this.require(filename);
  }
  writeFile(filename, content) {
    const file = this.get(filename);
    if (!file) {
      return this.set(filename, content);
    }
    file.write(content);
    return file;
  }
  appendFile(filename, content) {
    const file = this.get(filename);
    if (!file) {
      return this.set(filename, content);
    }
    file.append(content);
    return file;
  }
}
/* ============================================================
 * BrowC Pointer
 * ============================================================ */
class BrowCPointer {
  constructor(runtime, block, offset = 0, pointee = null) {
    this.__browc_pointer = true;
    this.runtime = runtime;
    this.block = block;
    this.offset = browcClampInteger(offset);
    this.pointee = pointee || null;
  }
  get address() {
    if (!this.block) {
      return 0;
    }
    return this.block.baseAddress + this.offset;
  }
  get valid() {
    return (
      !!this.block &&
      !this.block.freed &&
      this.offset >= 0 &&
      this.offset <= this.block.size
    );
  }
  clone() {
    return new BrowCPointer(
      this.runtime,
      this.block,
      this.offset,
      this.pointee
    );
  }
  add(amount) {
    return new BrowCPointer(
      this.runtime,
      this.block,
      this.offset + browcClampInteger(amount),
      this.pointee
    );
  }
  subtract(amount) {
    return this.add(-browcClampInteger(amount));
  }
  difference(other) {
    if (!browcIsPointer(other)) {
      throw new BrowCPointerError("pointer subtraction requires pointer");
    }
    if (this.block !== other.block) {
      throw new BrowCPointerError(
        "cannot subtract pointers from different objects"
      );
    }
    return this.offset - other.offset;
  }
  checkAlive() {
    if (!this.block) {
      throw new BrowCPointerError("null pointer");
    }
    if (this.block.freed) {
      throw new BrowCPointerError("use after free");
    }
    if (this.offset < 0 || this.offset > this.block.size) {
      throw new BrowCPointerError("pointer outside allocated object");
    }
  }
  readUint8() {
    this.checkAlive();
    if (this.offset >= this.block.size) {
      throw new BrowCMemoryError("out-of-bounds read");
    }
    return this.block.bytes[this.offset];
  }
  readInt8() {
    return browcToInt8(this.readUint8());
  }
  readUint16() {
    this.checkAlive();
    return this.block.view.getUint16(this.offset, true);
  }
  readInt16() {
    this.checkAlive();
    return this.block.view.getInt16(this.offset, true);
  }
  readUint32() {
    this.checkAlive();
    return this.block.view.getUint32(this.offset, true);
  }
  readInt32() {
    this.checkAlive();
    return this.block.view.getInt32(this.offset, true);
  }
  readFloat() {
    this.checkAlive();
    return this.block.view.getFloat32(this.offset, true);
  }
  readDouble() {
    this.checkAlive();
    return this.block.view.getFloat64(this.offset, true);
  }
  writeUint8(value) {
    this.checkAlive();
    if (this.offset >= this.block.size) {
      throw new BrowCMemoryError("out-of-bounds write");
    }
    this.block.bytes[this.offset] = browcToUint8(value);
    return this;
  }
  writeInt8(value) {
    return this.writeUint8(value);
  }
  writeUint16(value) {
    this.checkRange(2);
    this.block.view.setUint16(this.offset, browcToUint16(value), true);
    return this;
  }
  writeInt16(value) {
    this.checkRange(2);
    this.block.view.setInt16(this.offset, browcToInt16(value), true);
    return this;
  }
  writeUint32(value) {
    this.checkRange(4);
    this.block.view.setUint32(this.offset, browcToUint32(value), true);
    return this;
  }
  writeInt32(value) {
    this.checkRange(4);
    this.block.view.setInt32(this.offset, browcToInt32(value), true);
    return this;
  }
  writeFloat(value) {
    this.checkRange(4);
    this.block.view.setFloat32(this.offset, Number(value), true);
    return this;
  }
  writeDouble(value) {
    this.checkRange(8);
    this.block.view.setFloat64(this.offset, Number(value), true);
    return this;
  }
  checkRange(size) {
    this.checkAlive();
    if (this.offset < 0 || this.offset + size > this.block.size) {
      throw new BrowCMemoryError("out-of-bounds memory access");
    }
  }
  get() {
    return this.readUint8();
  }
  set(value) {
    this.writeUint8(value);
    return value;
  }
  readCString(maxLength = 1024 * 1024) {
    this.checkAlive();
    const chars = [];
    for (let i = 0; i < maxLength; i++) {
      const value = this.add(i).readUint8();
      if (value === 0) {
        break;
      }
      chars.push(value);
    }
    return new TextDecoder().decode(new Uint8Array(chars));
  }
  writeCString(value, includeNull = true) {
    const bytes = new TextEncoder().encode(String(value));
    this.checkRange(bytes.length + (includeNull ? 1 : 0));
    for (let i = 0; i < bytes.length; i++) {
      this.add(i).writeUint8(bytes[i]);
    }
    if (includeNull) {
      this.add(bytes.length).writeUint8(0);
    }
    return this;
  }
  toString() {
    if (!this.valid) {
      return "NULL";
    }
    return `BrowCPointer(0x${this.address.toString(16)})`;
  }
}
/* ============================================================
 * Memory block
 * ============================================================ */
class BrowCMemoryBlock {
  constructor(runtime, size, address, metadata = {}) {
    this.__browc_memory_block = true;
    this.runtime = runtime;
    this.size = Math.max(0, browcClampInteger(size));
    this.baseAddress = address;
    this.bytes = new Uint8Array(this.size);
    this.view = new DataView(this.bytes.buffer);
    this.freed = false;
    this.metadata = {
      ...metadata,
    };
  }
  pointer(offset = 0, pointee = null) {
    return new BrowCPointer(this.runtime, this, offset, pointee);
  }
}
/* ============================================================
 * BrowC Memory Manager
 * ============================================================ */
class BrowCMemoryManager {
  constructor(runtime, options = {}) {
    this.runtime = runtime;
    /*
     * Pseudo-address space.
     *
     * We do NOT pretend browser JavaScript has direct access
     * to physical memory. BrowC gets its own managed address
     * space.
     */
    this.nextAddress = options.baseAddress || 0x10000;
    this.blocks = new Map();
    this.byAddress = new Map();
    this.heapBytes = 0;
    this.maxHeap = options.maxHeap || 1024 * 1024 * 1024;
  }
  alignAddress(address, alignment = 8) {
    const a = Math.max(1, browcClampInteger(alignment, 1));
    return (address + a - 1) & ~(a - 1);
  }
  allocate(size, metadata = {}) {
    size = Math.max(1, browcClampInteger(size));
    if (this.heapBytes + size > this.maxHeap) {
      throw new BrowCMemoryError("BrowC heap limit exceeded");
    }
    const address = this.alignAddress(this.nextAddress);
    const block = new BrowCMemoryBlock(this.runtime, size, address, metadata);
    this.nextAddress = address + size + 16;
    this.heapBytes += size;
    this.blocks.set(address, block);
    this.byAddress.set(address, block);
    return block;
  }
  malloc(size) {
    const block = this.allocate(size, {
      allocator: "malloc",
    });
    return block.pointer();
  }
  calloc(count, size) {
    count = browcClampInteger(count);
    size = browcClampInteger(size);
    if (count < 0 || size < 0) {
      throw new BrowCMemoryError("invalid calloc size");
    }
    const total = count * size;
    const block = this.allocate(total, {
      allocator: "calloc",
    });
    block.bytes.fill(0);
    return block.pointer();
  }
  free(pointer) {
    if (pointer === null || pointer === undefined) {
      return;
    }
    if (!browcIsPointer(pointer)) {
      throw new BrowCPointerError("free() argument is not a pointer");
    }
    const block = pointer.block;
    if (!block) {
      return;
    }
    if (block.freed) {
      throw new BrowCMemoryError("double free");
    }
    /*
     * Freeing an interior pointer is invalid in C.
     */
    if (pointer.offset !== 0) {
      throw new BrowCMemoryError(
        "free() requires pointer to beginning of allocation"
      );
    }
    block.freed = true;
    this.blocks.delete(block.baseAddress);
    this.byAddress.delete(block.baseAddress);
    this.heapBytes -= block.size;
  }
  realloc(pointer, newSize) {
    newSize = Math.max(0, browcClampInteger(newSize));
    if (pointer === null || pointer === undefined) {
      return this.malloc(newSize);
    }
    if (!browcIsPointer(pointer)) {
      throw new BrowCPointerError("realloc() argument is not a pointer");
    }
    pointer.checkAlive();
    const oldBlock = pointer.block;
    if (pointer.offset !== 0) {
      throw new BrowCMemoryError("realloc() requires the base pointer");
    }
    if (newSize === 0) {
      this.free(pointer);
      return null;
    }
    const newBlock = this.allocate(newSize, {
      allocator: "realloc",
    });
    const count = Math.min(oldBlock.size, newSize);
    newBlock.bytes.set(oldBlock.bytes.subarray(0, count));
    this.free(pointer);
    return newBlock.pointer();
  }
  findByAddress(address) {
    address = browcClampInteger(address);
    for (const block of this.blocks.values()) {
      if (
        address >= block.baseAddress &&
        address <= block.baseAddress + block.size
      ) {
        return {
          block,
          offset: address - block.baseAddress,
        };
      }
    }
    return null;
  }
  pointerFromAddress(address) {
    if (address === 0 || address === null || address === undefined) {
      return null;
    }
    const result = this.findByAddress(address);
    if (!result) {
      throw new BrowCPointerError(
        `invalid BrowC address 0x${Number(address).toString(16)}`
      );
    }
    return result.block.pointer(result.offset);
  }
  memset(pointer, value, size) {
    pointer = this.requirePointer(pointer);
    size = browcClampInteger(size);
    pointer.checkRange(size);
    pointer.block.bytes.fill(
      browcToUint8(value),
      pointer.offset,
      pointer.offset + size
    );
    return pointer;
  }
  memcpy(destination, source, size) {
    destination = this.requirePointer(destination);
    source = this.requirePointer(source);
    size = browcClampInteger(size);
    destination.checkRange(size);
    source.checkRange(size);
    destination.block.bytes.set(
      source.block.bytes.subarray(source.offset, source.offset + size),
      destination.offset
    );
    return destination;
  }
  memmove(destination, source, size) {
    destination = this.requirePointer(destination);
    source = this.requirePointer(source);
    size = browcClampInteger(size);
    destination.checkRange(size);
    source.checkRange(size);
    const temporary = source.block.bytes.slice(
      source.offset,
      source.offset + size
    );
    destination.block.bytes.set(temporary, destination.offset);
    return destination;
  }
  memcmp(a, b, size) {
    a = this.requirePointer(a);
    b = this.requirePointer(b);
    size = browcClampInteger(size);
    a.checkRange(size);
    b.checkRange(size);
    for (let i = 0; i < size; i++) {
      const av = a.block.bytes[a.offset + i];
      const bv = b.block.bytes[b.offset + i];
      if (av !== bv) {
        return av < bv ? -1 : 1;
      }
    }
    return 0;
  }
  requirePointer(value) {
    if (!browcIsPointer(value)) {
      throw new BrowCPointerError("expected BrowC pointer");
    }
    value.checkAlive();
    return value;
  }
}
/* ============================================================
 * BrowC C-string helper
 * ============================================================ */
class BrowCString {
  constructor(runtime, pointer) {
    this.runtime = runtime;
    this.pointer = pointer;
  }
  toString() {
    if (typeof this.pointer === "string") {
      return this.pointer;
    }
    if (!browcIsPointer(this.pointer)) {
      return String(this.pointer ?? "");
    }
    return this.pointer.readCString();
  }
  valueOf() {
    return this.toString();
  }
}
/* ============================================================
 * DOM runtime
 * ============================================================ */
class BrowCDOMRuntime {
  constructor(runtime) {
    this.runtime = runtime;
  }
  createElement(tagName) {
    if (typeof document === "undefined") {
      throw new BrowCRuntimeError("DOM is unavailable");
    }
    return document.createElement(String(tagName));
  }
  getElementById(id) {
    return document.getElementById(String(id));
  }
  querySelector(selector) {
    return document.querySelector(String(selector));
  }
  querySelectorAll(selector) {
    return document.querySelectorAll(String(selector));
  }
  createTextNode(text) {
    return document.createTextNode(String(text));
  }
  appendChild(parent, child) {
    if (!parent) {
      throw new BrowCRuntimeError("appendChild(): null parent");
    }
    if (!child) {
      throw new BrowCRuntimeError("appendChild(): null child");
    }
    return parent.appendChild(child);
  }
  prependChild(parent, child) {
    if (!parent || !child) {
      throw new BrowCRuntimeError("prependChild(): invalid argument");
    }
    parent.insertBefore(child, parent.firstChild);
    return child;
  }
  removeChild(parent, child) {
    if (!parent || !child) {
      throw new BrowCRuntimeError("removeChild(): invalid argument");
    }
    return parent.removeChild(child);
  }
  updateTextContent(element, text) {
    if (!element) {
      throw new BrowCRuntimeError("updateTextContent(): null element");
    }
    element.textContent = String(text);
    return element;
  }
  getTextContent(element) {
    if (!element) {
      return "";
    }
    return element.textContent;
  }
  setAttribute(element, name, value) {
    if (!element) {
      throw new BrowCRuntimeError("setAttribute(): null element");
    }
    element.setAttribute(String(name), String(value));
    return element;
  }
  getAttribute(element, name) {
    if (!element) {
      throw new BrowCRuntimeError("getAttribute(): null element");
    }
    return element.getAttribute(String(name));
  }
  removeAttribute(element, name) {
    if (!element) {
      throw new BrowCRuntimeError("removeAttribute(): null element");
    }
    element.removeAttribute(String(name));
    return element;
  }
  addEventListener(element, event, callback, options = undefined) {
    if (!element || typeof element.addEventListener !== "function") {
      throw new BrowCRuntimeError("invalid event target");
    }
    element.addEventListener(String(event), callback, options);
    return callback;
  }
  removeEventListener(element, event, callback, options = undefined) {
    element.removeEventListener(String(event), callback, options);
  }
  dispatchEvent(element, event) {
    return element.dispatchEvent(event);
  }
  addClass(element, className) {
    element.classList.add(String(className));
    return element;
  }
  removeClass(element, className) {
    element.classList.remove(String(className));
    return element;
  }
  toggleClass(element, className) {
    return element.classList.toggle(String(className));
  }
  hasClass(element, className) {
    return element.classList.contains(String(className));
  }
  setStyle(element, property, value) {
    element.style[String(property)] = String(value);
    return element;
  }
  getStyle(element, property) {
    return getComputedStyle(element)[String(property)];
  }
  setHTML(element, html) {
    element.innerHTML = String(html);
    return element;
  }
  getHTML(element) {
    return element.innerHTML;
  }
  setValue(element, value) {
    element.value = value;
    return element;
  }
  getValue(element) {
    return element.value;
  }
  focus(element) {
    if (element && typeof element.focus === "function") {
      element.focus();
    }
  }
}
/* ============================================================
 * BrowC standard I/O
 * ============================================================ */
class BrowCStdIO {
  constructor(runtime) {
    this.runtime = runtime;
    this.inputQueue = [];
    this.outputListeners = new Set();
    this.errorListeners = new Set();
    this.stdout = typeof console !== "undefined" ? console : null;
    this.stdin = null;
  }
  onOutput(callback) {
    this.outputListeners.add(callback);
    return () => {
      this.outputListeners.delete(callback);
    };
  }
  onError(callback) {
    this.errorListeners.add(callback);
    return () => {
      this.errorListeners.delete(callback);
    };
  }
  emitOutput(text) {
    text = String(text);
    for (const listener of this.outputListeners) {
      try {
        listener(text);
      } catch (_) {
        /*
         * Output listeners must never break
         * C program execution.
         */
      }
    }
    /*
     * console.log() always appends its own trailing newline. C's printf
     * only ever writes the bytes it was given, so text that already ends
     * in "\n" (the overwhelmingly common case - "...\n" format strings)
     * was coming out doubled: "line\n" -> console.log("line\n") -> a
     * visible blank line after every printf. Under Node, write the exact
     * bytes via process.stdout.write (no implicit newline at all). Only
     * fall back to console.log (stripping one trailing newline, since
     * console.log supplies its own) when a raw stream isn't available.
     */
    if (
      typeof process !== "undefined" &&
      process.stdout &&
      typeof process.stdout.write === "function"
    ) {
      process.stdout.write(text);
      return;
    }
    if (this.stdout && typeof this.stdout.log === "function") {
      this.stdout.log(text.endsWith("\n") ? text.slice(0, -1) : text);
    }
  }
  emitError(text) {
    text = String(text);
    for (const listener of this.errorListeners) {
      try {
        listener(text);
      } catch (_) {
        //
      }
    }
    if (
      typeof process !== "undefined" &&
      process.stderr &&
      typeof process.stderr.write === "function"
    ) {
      process.stderr.write(text);
      return;
    }
    if (this.stdout && typeof this.stdout.error === "function") {
      this.stdout.error(text.endsWith("\n") ? text.slice(0, -1) : text);
    }
  }
  queueInput(value) {
    const text = String(value);
    for (const char of text) {
      this.inputQueue.push(char);
    }
    return this;
  }
  putchar(value) {
    const c = String.fromCharCode(Number(value) & 0xff);
    this.emitOutput(c);
    return c.charCodeAt(0);
  }
  puts(value) {
    const text = this.runtime.toCString(value);
    this.emitOutput(text + "\n");
    return 0;
  }
  getchar() {
    if (this.inputQueue.length === 0) {
      return -1;
    }
    return this.inputQueue.shift().charCodeAt(0);
  }
  printf(format, ...args) {
    const result = this.runtime.format(this.runtime.toCString(format), args);
    this.emitOutput(result);
    return result.length;
  }
  fprintf(stream, format, ...args) {
    const result = this.runtime.format(this.runtime.toCString(format), args);
    if (stream === this.runtime.stderr) {
      this.emitError(result);
    } else {
      this.emitOutput(result);
    }
    return result.length;
  }
}
/* ============================================================
 * Execution context
 * ============================================================ */
class BrowCExecutionContext {
  constructor(runtime, options = {}) {
    this.runtime = runtime;
    this.program = options.program || null;
    this.filename = options.filename || "<browc>";
    this.argv = Array.isArray(options.argv) ? options.argv : [];
    this.argc = this.argv.length;
    this.stackDepth = 0;
    this.callDepth = 0;
    this.startedAt = performance?.now?.() || Date.now();
    this.exitCode = 0;
    this.exited = false;
    this.exitReason = "normal";
  }
  enterCall() {
    this.callDepth++;
    if (this.callDepth > this.runtime.maxCallDepth) {
      throw new BrowCRuntimeError(
        "BrowC call stack limit exceeded",
        "STACK_OVERFLOW"
      );
    }
  }
  leaveCall() {
    this.callDepth = Math.max(0, this.callDepth - 1);
  }
  exit(code = 0) {
    this.exitCode = browcClampInteger(code);
    this.exited = true;
    this.exitReason = "exit";
  }
}
/* ============================================================
 * BrowC Runtime
 * ============================================================ */
class BrowCRuntimeClass {
  constructor(options = {}) {
    this.options = {
      root: options.root || (typeof document !== "undefined" ? document : null),
      maxHeap: options.maxHeap || 1024 * 1024 * 1024,
      maxCallDepth: options.maxCallDepth || 10000,
      executionTimeout: options.executionTimeout || 0,
      allowEval: options.allowEval !== false,
      console: options.console !== false,
    };
    this.maxCallDepth = this.options.maxCallDepth;
    /* --------------------------------------------------------
     * Virtual filesystem
     * -------------------------------------------------------- */
    this.fs = new BrowCVirtualFileSystem(this.options.root);
    /* --------------------------------------------------------
     * Memory
     * -------------------------------------------------------- */
    this.memory = new BrowCMemoryManager(this, {
      maxHeap: this.options.maxHeap,
    });
    /* --------------------------------------------------------
     * DOM
     * -------------------------------------------------------- */
    this.dom = new BrowCDOMRuntime(this);
    /* --------------------------------------------------------
     * I/O
     * -------------------------------------------------------- */
    this.io = new BrowCStdIO(this);
    /* --------------------------------------------------------
     * C file streams
     * -------------------------------------------------------- */
    this.stdin = {
      kind: "stdin",
    };
    this.stdout = {
      kind: "stdout",
    };
    this.stderr = {
      kind: "stderr",
    };
    /* --------------------------------------------------------
     * Execution
     * -------------------------------------------------------- */
    this.contextStack = [];
    this.currentProgram = null;
    this.programHistory = [];
    this.running = false;
    this.lastResult = null;
    this.lastError = null;
    this.exitCode = 0;
    /* --------------------------------------------------------
     * Timers
     * -------------------------------------------------------- */
    this.timers = new Map();
    this.nextTimerId = 1;
    /* --------------------------------------------------------
     * C runtime constants
     * -------------------------------------------------------- */
    this.constants = {
      NULL: 0,
      EOF: -1,
      EXIT_SUCCESS: 0,
      EXIT_FAILURE: 1,
      true: 1,
      false: 0,
      CHAR_BIT: 8,
      INT8_MIN: -128,
      INT8_MAX: 127,
      UINT8_MAX: 255,
      INT16_MIN: -32768,
      INT16_MAX: 32767,
      UINT16_MAX: 65535,
      INT32_MIN: -2147483648,
      INT32_MAX: 2147483647,
      UINT32_MAX: 4294967295,
      SIZE_MAX: Number.MAX_SAFE_INTEGER,
    };
    this.installDOMBridge();
  }
  /* ==========================================================
   * Context
   * ========================================================== */
  currentContext() {
    if (this.contextStack.length === 0) {
      return {
        runtime: this,
        fs: this.fs,
        memory: this.memory,
        dom: this.dom,
        io: this.io,
        argc: 0,
        argv: [],
      };
    }
    return this.contextStack[this.contextStack.length - 1];
  }
  pushContext(context) {
    this.contextStack.push(context);
    return context;
  }
  popContext() {
    return this.contextStack.pop();
  }
  /* ==========================================================
   * Actual JavaScript executor
   * ========================================================== */
  execute(javascript, options = {}) {
    if (!this.options.allowEval) {
      throw new BrowCRuntimeError("JavaScript execution is disabled");
    }
    javascript = String(javascript ?? "");
    const filename = options.filename || "<browc-output.js>";
    const argv = Array.isArray(options.argv) ? options.argv : [filename];
    const context = new BrowCExecutionContext(this, {
      program: javascript,
      filename,
      argv,
    });
    this.currentProgram = javascript;
    this.lastError = null;
    this.running = true;
    this.pushContext(context);
    const started = performance?.now?.() || Date.now();
    try {
      /*
       * IMPORTANT:
       *
       * This is the actual executor.
       *
       * The generated JavaScript is executed here.
       *
       * We provide a controlled set of parameters while
       * keeping normal browser globals available through
       * globalThis.
       */
      const executor = new Function(
        "__browc",
        "__runtime",
        "__global",
        `"use strict";\n` + javascript
      );
      const result = executor(this, this, globalThis);
      this.lastResult = result;
      this.exitCode = context.exited ? context.exitCode : 0;
      this.programHistory.push({
        filename,
        argv: [...argv],
        result,
        exitCode: this.exitCode,
        duration: (performance?.now?.() || Date.now()) - started,
      });
      return {
        result,
        exitCode: this.exitCode,
        filename,
        duration: (performance?.now?.() || Date.now()) - started,
      };
    } catch (error) {
      this.lastError = this.decorateError(error, filename);
      throw this.lastError;
    } finally {
      this.popContext();
      this.running = this.contextStack.length > 0;
    }
  }
  executeAsync(javascript, options = {}) {
    return Promise.resolve().then(() => this.execute(javascript, options));
  }
  decorateError(error, filename) {
    if (error instanceof Error) {
      error.message =
        `BrowC runtime error in ` + `${filename}: ${error.message}`;
      return error;
    }
    return new BrowCRuntimeError(
      `BrowC runtime error in ` + `${filename}: ${String(error)}`
    );
  }
  /* ==========================================================
   * Main execution
   * ========================================================== */
  runMain(main, options = {}) {
    if (typeof main !== "function") {
      throw new BrowCRuntimeError("BrowC program has no callable main()");
    }
    const filename = options.filename || "<browc>";
    const argv = Array.isArray(options.argv) ? options.argv : [];
    const context = new BrowCExecutionContext(this, {
      program: main,
      filename,
      argv,
    });
    this.pushContext(context);
    try {
      const returnValue = this.invoke(main, []);
      const exitCode = context.exited
        ? context.exitCode
        : this.toInt(returnValue);
      this.exitCode = exitCode;
      this.lastResult = returnValue;
      return exitCode;
    } finally {
      this.popContext();
    }
  }
  invoke(functionValue, args = [], thisArg = undefined) {
    if (typeof functionValue !== "function") {
      throw new BrowCRuntimeError("attempt to call non-function");
    }
    const context = this.currentContext();
    if (context && typeof context.enterCall === "function") {
      context.enterCall();
    }
    try {
      return functionValue.apply(thisArg, args);
    } finally {
      if (context && typeof context.leaveCall === "function") {
        context.leaveCall();
      }
    }
  }
  exit(code = 0) {
    const context = this.currentContext();
    if (context && typeof context.exit === "function") {
      context.exit(code);
    }
    this.exitCode = browcClampInteger(code);
    /*
     * Returning is enough for normal compiled main().
     * We intentionally do not throw here because generated
     * C functions can call exit().
     */
    return this.exitCode;
  }
  abort(message = "abort()") {
    throw new BrowCRuntimeError(String(message), "ABORT");
  }
  /* ==========================================================
   * C conversion semantics
   * ========================================================== */
  toInt(value) {
    if (browcIsPointer(value)) {
      return value.address === 0 ? 0 : 1;
    }
    return Number(value) | 0;
  }
  toUint(value) {
    return Number(value) >>> 0;
  }
  toDouble(value) {
    return Number(value);
  }
  toBool(value) {
    if (browcIsPointer(value)) {
      return value.valid ? 1 : 0;
    }
    return value ? 1 : 0;
  }
  toCString(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof BrowCString) {
      return value.toString();
    }
    if (browcIsPointer(value)) {
      return value.readCString();
    }
    if (typeof value === "object" && typeof value.toString === "function") {
      return value.toString();
    }
    return String(value);
  }
  /* ==========================================================
   * malloc/calloc/realloc/free
   * ========================================================== */
  malloc(size) {
    return this.memory.malloc(size);
  }
  calloc(count, size) {
    return this.memory.calloc(count, size);
  }
  realloc(pointer, size) {
    return this.memory.realloc(pointer, size);
  }
  free(pointer) {
    return this.memory.free(pointer);
  }
  /* ==========================================================
   * Pointer operations
   * ========================================================== */
  addressOf(getter, setter = null) {
    /*
     * This is the compatibility implementation expected by
     * the current AST -> JS backend.
     */
    return {
      __browc_pointer: true,
      get() {
        return getter();
      },
      set(value) {
        if (!setter) {
          throw new BrowCPointerError(
            "cannot assign through read-only reference"
          );
        }
        return setter(value);
      },
      add(amount) {
        /*
         * JavaScript variable references do not have an
         * address-space offset. This type therefore behaves
         * like a managed reference pointer.
         */
        if (!Number.isInteger(amount) || amount !== 0) {
          throw new BrowCPointerError(
            "cannot perform pointer arithmetic on variable reference"
          );
        }
        return this;
      },
    };
  }
  deref(pointer) {
    if (
      pointer &&
      pointer.__browc_pointer === true &&
      typeof pointer.get === "function"
    ) {
      return pointer.get();
    }
    return this.memory.requirePointer(pointer).readUint8();
  }
  /*
   * Write-side counterpart to deref(), used by the compiler for `*p = v`
   * (and `*p += v`, etc., which reads via deref() and writes back via
   * this). Previously `*p = v` was compiled as the literal, invalid JS
   * `__browc.deref(p) = v` - a call expression can't be an assignment
   * target, so this always threw "Invalid left-hand side in assignment"
   * before the program ever got a chance to run.
   */
  derefAssign(pointer, value) {
    if (
      pointer &&
      pointer.__browc_pointer === true &&
      typeof pointer.set === "function"
    ) {
      pointer.set(value);
      return value;
    }
    this.memory.requirePointer(pointer).writeUint8(value);
    return value;
  }
  pointerAdd(pointer, amount) {
    if (!browcIsPointer(pointer)) {
      throw new BrowCPointerError("pointer arithmetic requires pointer");
    }
    return pointer.add(amount);
  }
  pointerSubtract(pointer, amount) {
    if (!browcIsPointer(pointer)) {
      throw new BrowCPointerError("pointer arithmetic requires pointer");
    }
    return pointer.subtract(amount);
  }
  pointerDifference(a, b) {
    if (!browcIsPointer(a) || !browcIsPointer(b)) {
      throw new BrowCPointerError("pointer subtraction requires pointers");
    }
    return a.difference(b);
  }
  nullPointer() {
    return null;
  }
  /* ==========================================================
   * Typed memory
   * ========================================================== */
  load8(pointer) {
    return this.memory.requirePointer(pointer).readInt8();
  }
  loadU8(pointer) {
    return this.memory.requirePointer(pointer).readUint8();
  }
  load16(pointer) {
    return this.memory.requirePointer(pointer).readInt16();
  }
  loadU16(pointer) {
    return this.memory.requirePointer(pointer).readUint16();
  }
  load32(pointer) {
    return this.memory.requirePointer(pointer).readInt32();
  }
  loadU32(pointer) {
    return this.memory.requirePointer(pointer).readUint32();
  }
  loadFloat(pointer) {
    return this.memory.requirePointer(pointer).readFloat();
  }
  loadDouble(pointer) {
    return this.memory.requirePointer(pointer).readDouble();
  }
  store8(pointer, value) {
    return this.memory.requirePointer(pointer).writeInt8(value);
  }
  storeU8(pointer, value) {
    return this.memory.requirePointer(pointer).writeUint8(value);
  }
  store16(pointer, value) {
    return this.memory.requirePointer(pointer).writeInt16(value);
  }
  storeU16(pointer, value) {
    return this.memory.requirePointer(pointer).writeUint16(value);
  }
  store32(pointer, value) {
    return this.memory.requirePointer(pointer).writeInt32(value);
  }
  storeU32(pointer, value) {
    return this.memory.requirePointer(pointer).writeUint32(value);
  }
  storeFloat(pointer, value) {
    return this.memory.requirePointer(pointer).writeFloat(value);
  }
  storeDouble(pointer, value) {
    return this.memory.requirePointer(pointer).writeDouble(value);
  }
  /* ==========================================================
   * Memory functions
   * ========================================================== */
  memset(destination, value, size) {
    return this.memory.memset(destination, value, size);
  }
  memcpy(destination, source, size) {
    return this.memory.memcpy(destination, source, size);
  }
  memmove(destination, source, size) {
    return this.memory.memmove(destination, source, size);
  }
  memcmp(a, b, size) {
    return this.memory.memcmp(a, b, size);
  }
  /* ==========================================================
   * Strings
   * ========================================================== */
  strlen(value) {
    return this.toCString(value).length;
  }
  strcmp(a, b) {
    a = this.toCString(a);
    b = this.toCString(b);
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  }
  strncmp(a, b, count) {
    a = this.toCString(a);
    b = this.toCString(b);
    count = Math.max(0, browcClampInteger(count));
    const aa = a.slice(0, count);
    const bb = b.slice(0, count);
    if (aa === bb) {
      return 0;
    }
    return aa < bb ? -1 : 1;
  }
  strcpy(destination, source) {
    destination = this.memory.requirePointer(destination);
    destination.writeCString(this.toCString(source));
    return destination;
  }
  strncpy(destination, source, count) {
    destination = this.memory.requirePointer(destination);
    count = Math.max(0, browcClampInteger(count));
    const text = this.toCString(source);
    destination.checkRange(count);
    for (let i = 0; i < count; i++) {
      const value = i < text.length ? text.charCodeAt(i) : 0;
      destination.add(i).writeUint8(value);
    }
    return destination;
  }
  strcat(destination, source) {
    destination = this.memory.requirePointer(destination);
    const current = destination.readCString();
    destination.writeCString(current + this.toCString(source));
    return destination;
  }
  strncat(destination, source, count) {
    destination = this.memory.requirePointer(destination);
    count = Math.max(0, browcClampInteger(count));
    const current = destination.readCString();
    const addition = this.toCString(source).slice(0, count);
    destination.writeCString(current + addition);
    return destination;
  }
  strchr(value, character) {
    if (browcIsPointer(value)) {
      const target = browcToUint8(character);
      for (let i = 0; i < value.block.size - value.offset; i++) {
        if (value.add(i).readUint8() === target) {
          return value.add(i);
        }
      }
      return null;
    }
    const text = this.toCString(value);
    const index = text.indexOf(String.fromCharCode(browcToUint8(character)));
    return index < 0 ? null : index;
  }
  strstr(haystack, needle) {
    const h = this.toCString(haystack);
    const n = this.toCString(needle);
    return h.indexOf(n);
  }
  /* ==========================================================
   * String <-> memory allocation
   * ========================================================== */
  strdup(value) {
    const text = this.toCString(value);
    const bytes = new TextEncoder().encode(text);
    const pointer = this.malloc(bytes.length + 1);
    pointer.checkRange(bytes.length + 1);
    for (let i = 0; i < bytes.length; i++) {
      pointer.add(i).writeUint8(bytes[i]);
    }
    pointer.add(bytes.length).writeUint8(0);
    return pointer;
  }
  /* ==========================================================
   * sizeof / alignof / casts
   * ========================================================== */
  sizeof(value) {
    if (browcIsPointer(value)) {
      return 4;
    }
    if (typeof value === "boolean") {
      return 1;
    }
    if (typeof value === "number") {
      return 4;
    }
    if (typeof value === "string") {
      return value.length + 1;
    }
    if (value instanceof Uint8Array) {
      return value.byteLength;
    }
    return 4;
  }
  sizeofType(type) {
    if (!type) {
      return 0;
    }
    if (typeof type === "string") {
      return this.typeSizeFromNames([type]);
    }
    const specifiers = type.specifiers || [];
    const names = specifiers.map((item) => item.value || item.type || "");
    return this.typeSizeFromNames(names);
  }
  typeSizeFromNames(names) {
    if (names.includes("char")) {
      return 1;
    }
    if (names.includes("_Bool")) {
      return 1;
    }
    if (names.includes("short")) {
      return 2;
    }
    /*
     * BrowC uses a stable target model instead of inheriting
     * the host browser's C ABI.
     */
    if (names.includes("int")) {
      return 4;
    }
    if (names.includes("long")) {
      return 8;
    }
    if (names.includes("float")) {
      return 4;
    }
    if (names.includes("double")) {
      return 8;
    }
    if (names.includes("void")) {
      return 1;
    }
    if (names.includes("dom")) {
      return 4;
    }
    /*
     * pointers
     */
    if (names.includes("*")) {
      return 4;
    }
    return 4;
  }
  alignof(type) {
    const size = this.sizeofType(type);
    return Math.min(size, 8);
  }
  cast(type, value) {
    if (!type) {
      return value;
    }
    const names = (type.specifiers || []).map(
      (item) => item.value || item.type || ""
    );
    if (names.includes("_Bool")) {
      return this.toBool(value);
    }
    if (names.includes("char")) {
      return browcToInt8(value);
    }
    if (names.includes("unsigned")) {
      return this.toUint(value);
    }
    if (names.includes("short")) {
      return browcToInt16(value);
    }
    if (names.includes("int")) {
      return this.toInt(value);
    }
    if (names.includes("long")) {
      return BigInt(Math.trunc(Number(value)));
    }
    if (names.includes("float") || names.includes("double")) {
      return this.toDouble(value);
    }
    return value;
  }
  /* ==========================================================
   * printf formatter
   * ========================================================== */
  format(format, args) {
    format = String(format);
    let index = 0;
    const result = format.replace(
      /%(%|[-+0 #]*\d*(?:\.\d+)?[diuoxXfFeEscp])/g,
      (match, spec) => {
        if (spec === "%") {
          return "%";
        }
        const argument = args[index++];
        return this.formatSpecifier(spec, argument);
      }
    );
    return result;
  }
  formatSpecifier(spec, value) {
    const final = spec[spec.length - 1];
    switch (final) {
      case "d":
      case "i":
        return String(this.toInt(value));
      case "u":
        return String(this.toUint(value));
      case "o":
        return this.toUint(value).toString(8);
      case "x":
        return this.toUint(value).toString(16);
      case "X":
        return this.toUint(value).toString(16).toUpperCase();
      case "f":
      case "F": {
        const precisionMatch = spec.match(/\.(\d+)/);
        const precision = precisionMatch ? Number(precisionMatch[1]) : 6;
        return Number(value).toFixed(precision);
      }
      case "e":
      case "E":
        return Number(value).toExponential();
      case "c":
        return String.fromCharCode(this.toInt(value));
      case "s":
        return this.toCString(value);
      case "p":
        if (browcIsPointer(value)) {
          return "0x" + value.address.toString(16);
        }
        return "0x" + this.toUint(value).toString(16);
      default:
        return String(value);
    }
  }
  /* ==========================================================
   * I/O convenience functions
   * ========================================================== */
  printf(format, ...args) {
    return this.io.printf(format, ...args);
  }
  fprintf(stream, format, ...args) {
    return this.io.fprintf(stream, format, ...args);
  }
  putchar(value) {
    return this.io.putchar(value);
  }
  puts(value) {
    return this.io.puts(value);
  }
  getchar() {
    return this.io.getchar();
  }
  /* ==========================================================
   * File API
   * ========================================================== */
  fopen(filename, mode = "r") {
    filename = this.toCString(filename);
    mode = this.toCString(mode);
    const file = this.fs.get(filename);
    if (!file) {
      if (mode.includes("w") || mode.includes("a")) {
        return this.fs.set(filename, "");
      }
      return null;
    }
    return {
      __browc_file_stream: true,
      file,
      mode,
      position: mode.includes("a") ? file.content.length : 0,
    };
  }
  fclose(stream) {
    if (!stream || !stream.__browc_file_stream) {
      return -1;
    }
    return 0;
  }
  fread(destination, size, count, stream) {
    if (!stream || !stream.__browc_file_stream) {
      return 0;
    }
    destination = this.memory.requirePointer(destination);
    size = browcClampInteger(size);
    count = browcClampInteger(count);
    const total = size * count;
    const text = stream.file.content;
    const bytes = new TextEncoder().encode(text);
    const start = stream.position;
    const end = Math.min(bytes.length, start + total);
    const amount = end - start;
    destination.checkRange(amount);
    destination.block.bytes.set(bytes.subarray(start, end), destination.offset);
    stream.position = end;
    return size === 0 ? 0 : Math.floor(amount / size);
  }
  fwrite(source, size, count, stream) {
    if (!stream || !stream.__browc_file_stream) {
      return 0;
    }
    source = this.memory.requirePointer(source);
    size = browcClampInteger(size);
    count = browcClampInteger(count);
    const total = size * count;
    const bytes = source.block.bytes.slice(
      source.offset,
      source.offset + total
    );
    const text = new TextDecoder().decode(bytes);
    const before = stream.file.content.slice(0, stream.position);
    const after = stream.file.content.slice(stream.position + text.length);
    stream.file.write(before + text + after);
    stream.position += text.length;
    return count;
  }
  /* ==========================================================
   * Random/time
   * ========================================================== */
  rand() {
    return Math.floor(Math.random() * 2147483648) | 0;
  }
  srand(seed) {
    /*
     * BrowC does not silently alter Math.random's global
     * implementation. Store a deterministic local seed.
     */
    this.randomState = browcToUint32(seed);
    return this.randomState;
  }
  localRand() {
    if (this.randomState === undefined) {
      this.randomState = 0x12345678;
    }
    /*
     * xorshift32
     */
    let x = this.randomState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = browcToUint32(x);
    return this.randomState & 0x7fffffff;
  }
  time() {
    return Math.floor(Date.now() / 1000);
  }
  clock() {
    return performance?.now?.() || Date.now();
  }
  /* ==========================================================
   * Timers
   * ========================================================== */
  setTimeout(callback, milliseconds) {
    const id = this.nextTimerId++;
    const handle = setTimeout(() => {
      this.timers.delete(id);
      this.invoke(callback, []);
    }, milliseconds);
    this.timers.set(id, {
      type: "timeout",
      handle,
    });
    return id;
  }
  clearTimeout(id) {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }
    clearTimeout(timer.handle);
    this.timers.delete(id);
  }
  setInterval(callback, milliseconds) {
    const id = this.nextTimerId++;
    const handle = setInterval(() => {
      try {
        this.invoke(callback, []);
      } catch (error) {
        this.lastError = error;
        this.clearInterval(id);
        if (typeof console !== "undefined") {
          console.error(error);
        }
      }
    }, milliseconds);
    this.timers.set(id, {
      type: "interval",
      handle,
    });
    return id;
  }
  clearInterval(id) {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }
    clearInterval(timer.handle);
    this.timers.delete(id);
  }
  /* ==========================================================
   * JavaScript escape hatch
   * ========================================================== */
  executeJS(code) {
    code = this.toCString(code);
    /*
     * __js__() explicitly means "execute browser JavaScript".
     */
    const fn = new Function("__browc", "__runtime", `"use strict";\n${code}`);
    return fn(this, this);
  }
  evaluateJS(expression) {
    expression = this.toCString(expression);
    const fn = new Function(
      "__browc",
      "__runtime",
      `"use strict";\n` + `return (${expression});`
    );
    return fn(this, this);
  }
  /* ==========================================================
   * Global bridge
   * ========================================================== */
  installDOMBridge() {
    if (typeof globalThis === "undefined") {
      return;
    }
    /*
     * Runtime itself.
     */
    globalThis.BrowCRuntime = this;
    /*
     * Common C/browser.h names.
     */
    globalThis.createelement = (...args) =>
      this.dom.createElement(args[1] ?? args[0]);
    globalThis.updatetextcontent = (element, text) =>
      this.dom.updateTextContent(element, text);
    globalThis.appendchild = (parent, child) =>
      this.dom.appendChild(parent, child);
    globalThis.setattribute = (element, name, value) =>
      this.dom.setAttribute(element, name, value);
    globalThis.getattribute = (element, name) =>
      this.dom.getAttribute(element, name);
    globalThis.queryselector = (selector) => this.dom.querySelector(selector);
    globalThis.getelementbyid = (id) => this.dom.getElementById(id);
  }
  /* ==========================================================
   * Browser-facing BrowC API
   * ========================================================== */
  createelement(type, name) {
    /*
     * The first argument allows browser.h to use a logical
     * BrowC element enum:
     *
     *   createelement(paragraph, "p");
     *
     * but the second argument may directly be the tag name.
     */
    const tag =
      name !== undefined ? this.toCString(name) : this.toCString(type);
    return this.dom.createElement(tag);
  }
  updatetextcontent(element, text) {
    return this.dom.updateTextContent(element, this.toCString(text));
  }
  appendchild(parent, child) {
    return this.dom.appendChild(parent, child);
  }
  /* ==========================================================
   * Memory debug
   * ========================================================== */
  memoryInfo() {
    return {
      blocks: this.memory.blocks.size,
      heapBytes: this.memory.heapBytes,
      nextAddress: this.memory.nextAddress,
    };
  }
  dumpMemory(pointer, size) {
    pointer = this.memory.requirePointer(pointer);
    size = browcClampInteger(size);
    pointer.checkRange(size);
    return Array.from(
      pointer.block.bytes.slice(pointer.offset, pointer.offset + size)
    );
  }
  /* ==========================================================
   * Reset
   * ========================================================== */
  reset() {
    /*
     * Cancel timers.
     */
    for (const id of this.timers.keys()) {
      const timer = this.timers.get(id);
      if (timer.type === "timeout") {
        clearTimeout(timer.handle);
      } else {
        clearInterval(timer.handle);
      }
    }
    this.timers.clear();
    /*
     * Reset memory.
     */
    this.memory = new BrowCMemoryManager(this, {
      maxHeap: this.options.maxHeap,
    });
    this.contextStack = [];
    this.currentProgram = null;
    this.lastResult = null;
    this.lastError = null;
    this.running = false;
    this.exitCode = 0;
    this.fs.scan();
  }
}
/* ============================================================
 * Built-in C functions
 * ============================================================ */
function installBrowCBuiltins(runtime) {
  const global = typeof globalThis !== "undefined" ? globalThis : {};
  /* ----------------------------------------------------------
   * Memory
   * ---------------------------------------------------------- */
  global.malloc = runtime.malloc.bind(runtime);
  global.calloc = runtime.calloc.bind(runtime);
  global.realloc = runtime.realloc.bind(runtime);
  global.free = runtime.free.bind(runtime);
  global.memset = runtime.memset.bind(runtime);
  global.memcpy = runtime.memcpy.bind(runtime);
  global.memmove = runtime.memmove.bind(runtime);
  global.memcmp = runtime.memcmp.bind(runtime);
  /* ----------------------------------------------------------
   * Strings
   * ---------------------------------------------------------- */
  global.strlen = runtime.strlen.bind(runtime);
  global.strcmp = runtime.strcmp.bind(runtime);
  global.strncmp = runtime.strncmp.bind(runtime);
  global.strcpy = runtime.strcpy.bind(runtime);
  global.strncpy = runtime.strncpy.bind(runtime);
  global.strcat = runtime.strcat.bind(runtime);
  global.strncat = runtime.strncat.bind(runtime);
  global.strchr = runtime.strchr.bind(runtime);
  global.strstr = runtime.strstr.bind(runtime);
  global.strdup = runtime.strdup.bind(runtime);
  /* ----------------------------------------------------------
   * I/O
   * ---------------------------------------------------------- */
  global.printf = runtime.printf.bind(runtime);
  global.fprintf = runtime.fprintf.bind(runtime);
  global.putchar = runtime.putchar.bind(runtime);
  global.puts = runtime.puts.bind(runtime);
  global.getchar = runtime.getchar.bind(runtime);
  /* ----------------------------------------------------------
   * Files
   * ---------------------------------------------------------- */
  global.fopen = runtime.fopen.bind(runtime);
  global.fclose = runtime.fclose.bind(runtime);
  global.fread = runtime.fread.bind(runtime);
  global.fwrite = runtime.fwrite.bind(runtime);
  /* ----------------------------------------------------------
   * Program control
   * ---------------------------------------------------------- */
  global.exit = runtime.exit.bind(runtime);
  global.abort = runtime.abort.bind(runtime);
  /* ----------------------------------------------------------
   * Random/time
   * ---------------------------------------------------------- */
  global.rand = runtime.localRand.bind(runtime);
  global.srand = runtime.srand.bind(runtime);
  global.time = runtime.time.bind(runtime);
  global.clock = runtime.clock.bind(runtime);
  /* ----------------------------------------------------------
   * DOM
   * ---------------------------------------------------------- */
  global.createelement = runtime.createelement.bind(runtime);
  global.updatetextcontent = runtime.updatetextcontent.bind(runtime);
  global.appendchild = runtime.appendchild.bind(runtime);
  global.setattribute = runtime.dom.setAttribute.bind(runtime.dom);
  global.getattribute = runtime.dom.getAttribute.bind(runtime.dom);
  global.queryselector = runtime.dom.querySelector.bind(runtime.dom);
  global.getelementbyid = runtime.dom.getElementById.bind(runtime.dom);
}
/* ============================================================
 * <browc-file>
 * ============================================================ */
function installBrowCFileElement() {
  if (
    typeof customElements === "undefined" ||
    typeof HTMLElement === "undefined"
  ) {
    return;
  }
  if (customElements.get("browc-file")) {
    return;
  }
  class BrowCFileElement extends HTMLElement {
    static get observedAttributes() {
      return ["filename", "content"];
    }
    connectedCallback() {
      this.refresh();
    }
    attributeChangedCallback() {
      if (this.isConnected) {
        this.refresh();
      }
    }
    refresh() {
      if (globalThis.BrowCRuntime) {
        globalThis.BrowCRuntime.fs.scan();
      }
    }
  }
  customElements.define("browc-file", BrowCFileElement);
}
/* ============================================================
 * Bootstrap runtime
 * ============================================================ */
const BrowCRuntime = new BrowCRuntimeClass();
installBrowCBuiltins(BrowCRuntime);
installBrowCFileElement();
/*
 * Global runtime.
 */
if (typeof globalThis !== "undefined") {
  globalThis.BrowCRuntime = BrowCRuntime;
  globalThis.BrowCVirtualFileSystem = BrowCVirtualFileSystem;
  globalThis.BrowCMemoryManager = BrowCMemoryManager;
  globalThis.BrowCMemoryBlock = BrowCMemoryBlock;
  globalThis.BrowCPointer = BrowCPointer;
  globalThis.BrowCString = BrowCString;
  globalThis.BrowCRuntimeError = BrowCRuntimeError;
  globalThis.BrowCMemoryError = BrowCMemoryError;
  globalThis.BrowCPointerError = BrowCPointerError;
  globalThis.BrowCFileError = BrowCFileError;
}
/* ============================================================
 * CommonJS
 * ============================================================ */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BrowCRuntimeClass,
    BrowCRuntimeError,
    BrowCMemoryError,
    BrowCPointerError,
    BrowCFileError,
    BrowCFile,
    BrowCVirtualFileSystem,
    BrowCPointer,
    BrowCMemoryBlock,
    BrowCMemoryManager,
    BrowCString,
    BrowCDOMRuntime,
    BrowCStdIO,
    BrowCExecutionContext,
    BrowCRuntime,
  };
}
/*
browc-stdlib.js
BROWC STANDARD LIBRARY
*/
("use strict");
/* ========================================================================
 * CONSTANTS / HOST HELPERS
 * ====================================================================== */
const BROWC = {
  VERSION: "1.0.0",
  FILE_TAG: "browc-file",
  EOF: -1,
  errno: {
    EPERM: 1,
    ENOENT: 2,
    ESRCH: 3,
    EINTR: 4,
    EIO: 5,
    ENXIO: 6,
    E2BIG: 7,
    ENOEXEC: 8,
    EBADF: 9,
    ECHILD: 10,
    EAGAIN: 11,
    ENOMEM: 12,
    EACCES: 13,
    EFAULT: 14,
    EBUSY: 16,
    EEXIST: 17,
    ENODEV: 19,
    ENOTDIR: 20,
    EISDIR: 21,
    EINVAL: 22,
    ENFILE: 23,
    EMFILE: 24,
    ENOTTY: 25,
    EFBIG: 27,
    ENOSPC: 28,
    ESPIPE: 29,
    EROFS: 30,
    EMLINK: 31,
    EPIPE: 32,
    EDOM: 33,
    ERANGE: 34,
    EDEADLK: 35,
    ENAMETOOLONG: 36,
    ENOSYS: 38,
    ENOTEMPTY: 39,
    EILSEQ: 84,
  },
};
function hasDocument() {
  return typeof document !== "undefined";
}
function hasWindow() {
  return typeof window !== "undefined";
}
function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}
function hasSessionStorage() {
  try {
    return typeof sessionStorage !== "undefined";
  } catch {
    return false;
  }
}
function runtime() {
  return globalThis.__BROWC_RUNTIME__ || null;
}
function runtimeCall(name, args = []) {
  const r = runtime();
  if (!r) return undefined;
  if (typeof r.stdlibCall === "function") {
    const value = r.stdlibCall(name, args);
    if (value !== undefined) return value;
  }
  if (r.stdlib && typeof r.stdlib[name] === "function") {
    return r.stdlib[name](...args);
  }
  return undefined;
}
function setErrno(value) {
  globalThis.__BROWC_ERRNO__ = Number(value) | 0;
}
function getErrno() {
  return Number(globalThis.__BROWC_ERRNO__ || 0) | 0;
}
function fail(error, errno = BROWC.errno.EIO) {
  globalThis.__BROWC_LAST_ERROR__ = error;
  setErrno(errno);
}
function cstr(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (isMemory(value)) {
    const u8 = memoryView(value);
    let n = 0;
    while (n < u8.length && u8[n] !== 0) n++;
    return new TextDecoder().decode(u8.slice(0, n));
  }
  if (value instanceof Uint8Array) {
    let n = 0;
    while (n < value.length && value[n] !== 0) n++;
    return new TextDecoder().decode(value.slice(0, n));
  }
  return String(value);
}
function utf8(value) {
  return new TextEncoder().encode(String(value ?? ""));
}
function utf8z(value) {
  const raw = utf8(value);
  const out = new Uint8Array(raw.length + 1);
  out.set(raw, 0);
  out[raw.length] = 0;
  return out;
}
/* ========================================================================
 * MEMORY / POINTER MODEL
 * ====================================================================== */
function isMemory(value) {
  return !!(
    value &&
    typeof value === "object" &&
    value.__browc_memory instanceof Uint8Array &&
    value.__browc_freed !== true
  );
}
function memoryView(ptr) {
  if (ptr instanceof Uint8Array) return ptr;
  if (ptr instanceof ArrayBuffer) return new Uint8Array(ptr);
  if (ArrayBuffer.isView(ptr)) {
    return new Uint8Array(ptr.buffer, ptr.byteOffset, ptr.byteLength);
  }
  if (!isMemory(ptr)) {
    throw new Error("BrowC invalid memory/pointer");
  }
  return ptr.__browc_memory;
}
function memoryObject(size, alignment = 1) {
  size = Math.max(0, Number(size) || 0);
  return {
    __browc_memory: new Uint8Array(size),
    __browc_size: size,
    __browc_alignment: Number(alignment) || 1,
    __browc_freed: false,
    __browc_type: "memory",
  };
}
function pointerOffset(base, offset) {
  if (!isMemory(base)) return null;
  return {
    __browc_ptr: true,
    base,
    offset: Number(offset) || 0,
  };
}
function derefPointer(ptr) {
  if (ptr && ptr.__browc_ptr) {
    return {
      memory: memoryView(ptr.base),
      offset: ptr.offset | 0,
    };
  }
  return {
    memory: memoryView(ptr),
    offset: 0,
  };
}
function checkedMemory(ptr) {
  const d = derefPointer(ptr);
  if (!d.memory) throw new Error("BrowC invalid pointer");
  if (d.offset < 0 || d.offset > d.memory.length) {
    throw new Error("BrowC pointer out of bounds");
  }
  return d;
}
function memorySize(ptr) {
  try {
    const d = checkedMemory(ptr);
    return Math.max(0, d.memory.length - d.offset);
  } catch {
    return 0;
  }
}
function memoryRead(ptr, count) {
  const d = checkedMemory(ptr);
  const n = Math.max(0, Number(count) || 0);
  return d.memory.slice(d.offset, Math.min(d.memory.length, d.offset + n));
}
function memoryWrite(ptr, bytes) {
  const d = checkedMemory(ptr);
  const source =
    bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  const n = Math.min(source.length, d.memory.length - d.offset);
  if (n > 0) d.memory.set(source.slice(0, n), d.offset);
  return ptr;
}
function readCStringBytes(ptr, count = null) {
  const d = checkedMemory(ptr);
  const max =
    count == null
      ? d.memory.length - d.offset
      : Math.max(0, Number(count) || 0);
  let n = 0;
  while (
    n < max &&
    d.offset + n < d.memory.length &&
    d.memory[d.offset + n] !== 0
  ) {
    n++;
  }
  return d.memory.slice(d.offset, d.offset + n);
}
function writeCString(ptr, text, limit = null) {
  const d = checkedMemory(ptr);
  const bytes = utf8z(text);
  if (limit == null) {
    limit = d.memory.length - d.offset;
  }
  limit = Math.max(0, Math.min(Number(limit) || 0, d.memory.length - d.offset));
  if (limit === 0) return ptr;
  const n = Math.min(bytes.length, limit);
  d.memory.fill(0, d.offset, d.offset + limit);
  d.memory.set(bytes.slice(0, n), d.offset);
  if (n === limit && limit > 0) {
    d.memory[d.offset + limit - 1] = 0;
  }
  return ptr;
}
function alloc(size) {
  return memoryObject(size);
}
function calloc(count, size) {
  return memoryObject(
    Math.max(0, Number(count) || 0) * Math.max(0, Number(size) || 0)
  );
}
function realloc(ptr, newSize) {
  newSize = Math.max(0, Number(newSize) || 0);
  if (ptr == null) {
    return memoryObject(newSize);
  }
  const old = memoryView(ptr);
  const out = memoryObject(newSize);
  out.__browc_memory.set(old.slice(0, newSize));
  if (isMemory(ptr)) {
    ptr.__browc_freed = true;
  }
  return out;
}
function free(ptr) {
  if (isMemory(ptr)) {
    ptr.__browc_freed = true;
    ptr.__browc_memory = new Uint8Array(0);
    ptr.__browc_size = 0;
  }
}
/* ========================================================================
 * FILES: <browc-file>
 * ====================================================================== */
function isBrowCFile(file) {
  return !!(
    file &&
    (String(file.tagName || "").toLowerCase() === BROWC.FILE_TAG ||
      file.__browc_file === true)
  );
}
function fileElements() {
  if (!hasDocument()) return [];
  return Array.from(document.querySelectorAll(BROWC.FILE_TAG));
}
function escapeSelectorText(s) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(String(s));
  }
  return String(s).replace(/["\\]/g, "\\$&");
}
function findFile(filename) {
  if (!hasDocument()) return null;
  const name = String(filename);
  return (
    fileElements().find((f) => f.getAttribute("filename") === name) || null
  );
}
function ensureFile(filename, mode = "w+") {
  if (!hasDocument()) return null;
  let file = findFile(filename);
  if (!file) {
    file = document.createElement(BROWC.FILE_TAG);
    file.setAttribute("filename", String(filename));
    file.setAttribute("mode", String(mode));
    file.setAttribute("content", "");
    file.hidden = true;
    document.body
      ? document.body.appendChild(file)
      : document.documentElement.appendChild(file);
  }
  initFileState(file);
  return file;
}
function initFileState(file) {
  if (!file) return;
  file.__browc_file = true;
  if (!file.hasAttribute("content")) {
    file.setAttribute("content", "");
  }
  if (!file.hasAttribute("mode")) {
    file.setAttribute("mode", "r+");
  }
  if (!Number.isFinite(file.__browc_position)) {
    file.__browc_position = 0;
  }
  file.__browc_eof = !!file.__browc_eof;
  file.__browc_error = !!file.__browc_error;
  file.__browc_closed = !!file.__browc_closed;
  file.__browc_temp = !!file.__browc_temp;
}
function initAllFiles() {
  for (const file of fileElements()) initFileState(file);
}
function fopen(filename, mode) {
  filename = cstr(filename);
  mode = cstr(mode);
  if (!hasDocument()) {
    fail("fopen(): document unavailable", BROWC.errno.ENOSYS);
    return null;
  }
  let file = findFile(filename);
  const baseMode = mode[0] || "r";
  const updating = mode.includes("+");
  if (baseMode === "r") {
    if (!file) {
      setErrno(BROWC.errno.ENOENT);
      return null;
    }
  }
  if (baseMode === "w") {
    if (!file) {
      file = ensureFile(filename, mode);
    }
    file.setAttribute("content", "");
  }
  if (baseMode === "a") {
    if (!file) file = ensureFile(filename, mode);
  }
  if (!file) {
    setErrno(BROWC.errno.ENOENT);
    return null;
  }
  initFileState(file);
  file.setAttribute("mode", mode);
  file.__browc_closed = false;
  file.__browc_error = false;
  file.__browc_eof = false;
  const content = file.getAttribute("content") || "";
  file.__browc_position = baseMode === "a" ? content.length : 0;
  file.__browc_append = baseMode === "a";
  file.__browc_update = updating;
  return file;
}
function fclose(file) {
  if (!isBrowCFile(file) || file.__browc_closed) {
    setErrno(BROWC.errno.EBADF);
    return BROWC.EOF;
  }
  file.__browc_closed = true;
  if (file.__browc_temp && file.parentNode) {
    file.remove();
  }
  return 0;
}
function fileContent(file) {
  return file.getAttribute("content") || "";
}
function fileSetContent(file, text) {
  file.setAttribute("content", String(text));
}
function fileEnsureOpen(file) {
  if (!isBrowCFile(file) || file.__browc_closed) {
    setErrno(BROWC.errno.EBADF);
    return false;
  }
  return true;
}
function fread(ptr, size, count, file) {
  if (!fileEnsureOpen(file)) return 0;
  size = Math.max(0, Number(size) || 0);
  count = Math.max(0, Number(count) || 0);
  if (size === 0 || count === 0) return 0;
  const total = size * count;
  const text = fileContent(file);
  const start = file.__browc_position || 0;
  const chunk = text.slice(start, start + total);
  const bytes = utf8(chunk);
  memoryWrite(ptr, bytes);
  file.__browc_position = start + chunk.length;
  if (file.__browc_position >= text.length) file.__browc_eof = true;
  return Math.floor(bytes.length / size);
}
function fwrite(ptr, size, count, file) {
  if (!fileEnsureOpen(file)) return 0;
  size = Math.max(0, Number(size) || 0);
  count = Math.max(0, Number(count) || 0);
  if (size === 0 || count === 0) return 0;
  const total = size * count;
  const bytes = memoryRead(ptr, total);
  const text = new TextDecoder().decode(bytes);
  let content = fileContent(file);
  let position = Number(file.__browc_position || 0);
  if (file.__browc_append) position = content.length;
  const before = content.slice(0, position);
  const after = content.slice(position + text.length);
  fileSetContent(file, before + text + after);
  file.__browc_position = position + text.length;
  return count;
}
function fgetc(file) {
  if (!fileEnsureOpen(file)) return BROWC.EOF;
  const text = fileContent(file);
  const p = Number(file.__browc_position || 0);
  if (p >= text.length) {
    file.__browc_eof = true;
    return BROWC.EOF;
  }
  file.__browc_position = p + 1;
  return text.charCodeAt(p) & 0xff;
}
function fputc(c, file) {
  if (!fileEnsureOpen(file)) return BROWC.EOF;
  const ch = String.fromCharCode(Number(c) & 0xff);
  let content = fileContent(file);
  let p = file.__browc_append
    ? content.length
    : Number(file.__browc_position || 0);
  if (p > content.length) p = content.length;
  content = content.slice(0, p) + ch + content.slice(p + 1);
  fileSetContent(file, content);
  file.__browc_position = p + 1;
  return ch.charCodeAt(0);
}
function fputs(text, file) {
  const value = cstr(text);
  const bytes = utf8z(value);
  const temporary = memoryObject(bytes.length);
  temporary.__browc_memory.set(bytes);
  fwrite(temporary, 1, bytes.length - 1, file);
  return value.length;
}
function fgets(ptr, n, file) {
  if (!fileEnsureOpen(file)) return null;
  n = Math.max(0, Number(n) || 0);
  if (n <= 0) return null;
  const text = fileContent(file);
  let p = Number(file.__browc_position || 0);
  if (p >= text.length) {
    file.__browc_eof = true;
    return null;
  }
  let end = p;
  while (end < text.length && end - p < n - 1 && text[end] !== "\n") {
    end++;
  }
  if (end < text.length && text[end] === "\n" && end - p < n - 1) {
    end++;
  }
  const value = text.slice(p, end);
  file.__browc_position = end;
  writeCString(ptr, value, n);
  return ptr;
}
function fprintf(file, format, args) {
  if (!fileEnsureOpen(file)) return BROWC.EOF;
  const out = cFormat(cstr(format), args);
  const bytes = utf8(out);
  const temp = memoryObject(bytes.length);
  temp.__browc_memory.set(bytes);
  fwrite(temp, 1, bytes.length, file);
  return out.length;
}
function fflush(file) {
  if (file == null) return 0;
  if (!fileEnsureOpen(file)) return BROWC.EOF;
  return 0;
}
function ftell(file) {
  if (!fileEnsureOpen(file)) return -1;
  return Number(file.__browc_position || 0);
}
function fseek(file, offset, origin) {
  if (!fileEnsureOpen(file)) return BROWC.EOF;
  const text = fileContent(file);
  offset = Number(offset) || 0;
  origin = Number(origin) || 0;
  let p;
  if (origin === 0) p = offset;
  else if (origin === 1) p = Number(file.__browc_position || 0) + offset;
  else if (origin === 2) p = text.length + offset;
  else {
    setErrno(BROWC.errno.EINVAL);
    return BROWC.EOF;
  }
  p = Math.max(0, Math.min(text.length, p));
  file.__browc_position = p;
  file.__browc_eof = false;
  return 0;
}
function rewind(file) {
  if (!fileEnsureOpen(file)) return;
  file.__browc_position = 0;
  file.__browc_eof = false;
  file.__browc_error = false;
}
function feof(file) {
  return isBrowCFile(file) && file.__browc_eof ? 1 : 0;
}
function ferror(file) {
  return isBrowCFile(file) && file.__browc_error ? 1 : 0;
}
function clearerr(file) {
  if (isBrowCFile(file)) {
    file.__browc_eof = false;
    file.__browc_error = false;
  }
}
function tmpfile() {
  if (!hasDocument()) return null;
  const file = document.createElement(BROWC.FILE_TAG);
  file.setAttribute(
    "filename",
    `__browc_tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
  file.setAttribute("mode", "w+");
  file.setAttribute("content", "");
  file.hidden = true;
  file.__browc_temp = true;
  (document.body || document.documentElement).appendChild(file);
  initFileState(file);
  return file;
}
function tmpnam(ptr) {
  const name = `__browc_tmp_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;
  if (ptr != null) {
    writeCString(ptr, name);
    return ptr;
  }
  return name;
}
/* ========================================================================
 * FORMATTERS
 * ====================================================================== */
function cFormat(format, args = []) {
  let index = 0;
  return String(format).replace(
    /%(%|[-+ #0]*)(\d+)?(?:\.(\d+))?(hh|h|ll|l|j|z|t|L)?([diouxXfFeEgGaAcspn])/g,
    (match, flags, width, precision, length, type) => {
      if (type === "%") return "%";
      const value = args[index++];
      const numeric = Number(value);
      let out = "";
      switch (type) {
        case "d":
        case "i":
          out = Number.isFinite(numeric)
            ? Math.trunc(numeric).toString(10)
            : "0";
          break;
        case "o":
          out = (Math.trunc(numeric) >>> 0).toString(8);
          break;
        case "u":
          out = (Math.trunc(numeric) >>> 0).toString(10);
          break;
        case "x":
          out = (Math.trunc(numeric) >>> 0).toString(16);
          break;
        case "X":
          out = (Math.trunc(numeric) >>> 0).toString(16).toUpperCase();
          break;
        case "f":
        case "F":
          out = Number(numeric).toFixed(
            precision == null ? 6 : Number(precision)
          );
          break;
        case "e":
        case "E":
          out = Number(numeric).toExponential(
            precision == null ? 6 : Number(precision)
          );
          if (type === "E") out = out.toUpperCase();
          break;
        case "g":
        case "G":
          out = Number(numeric).toString();
          if (type === "G") out = out.toUpperCase();
          break;
        case "a":
        case "A":
          out = Number(numeric).toString(16);
          if (type === "A") out = out.toUpperCase();
          break;
        case "c":
          out = String.fromCharCode(Number(value) & 0xff);
          break;
        case "s":
          out = cstr(value);
          if (precision != null) out = out.slice(0, Number(precision));
          break;
        case "p":
          if (value && typeof value === "object") {
            const id =
              value.__browc_pointer_id ||
              (value.__browc_pointer_id = `0x${Math.floor(
                Math.random() * 0xffffffff
              )
                .toString(16)
                .padStart(8, "0")}`);
            out = id;
          } else {
            out = `0x${Math.trunc(Number(value) || 0).toString(16)}`;
          }
          break;
        case "n":
          /*
           * Real %n needs a writable C pointer. The number of already
           * generated output characters is not directly available from
           * replace() here, so the compiler/runtime can provide a special
           * __browc_format_n implementation when needed.
           */
          out = "";
          break;
        default:
          out = String(value ?? "");
      }
      if (flags.includes("#")) {
        if (type === "x" && numeric !== 0) out = "0x" + out;
        if (type === "X" && numeric !== 0) out = "0X" + out;
        if (type === "o" && !out.startsWith("0")) out = "0" + out;
      }
      if (flags.includes("+") && numeric >= 0 && /^[0-9]/.test(out)) {
        out = "+" + out;
      } else if (flags.includes(" ") && numeric >= 0 && /^[0-9]/.test(out)) {
        out = " " + out;
      }
      if (width) {
        const w = Number(width);
        if (
          flags.includes("0") &&
          !flags.includes("-") &&
          !out.startsWith("-")
        ) {
          out = out.padStart(w, "0");
        } else if (flags.includes("-")) {
          out = out.padEnd(w, " ");
        } else {
          out = out.padStart(w, " ");
        }
      }
      return out;
    }
  );
}
/* ========================================================================
 * RANDOM
 * ====================================================================== */
function srand(seed) {
  globalThis.__BROWC_RAND_STATE__ = Number(seed) >>> 0 || 0x12345678;
  return 0;
}
function rand() {
  if (globalThis.__BROWC_RAND_STATE__ == null) srand(0x12345678);
  let x = globalThis.__BROWC_RAND_STATE__ >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  globalThis.__BROWC_RAND_STATE__ = x >>> 0;
  return x % 2147483648;
}
/* ========================================================================
 * STRING / MEMORY FUNCTIONS
 * ====================================================================== */
function strlen(s) {
  return cstr(s).length;
}
function strnlen(s, n) {
  return cstr(s).slice(0, Math.max(0, Number(n) || 0)).length;
}
function strcmp(a, b) {
  a = cstr(a);
  b = cstr(b);
  return a < b ? -1 : a > b ? 1 : 0;
}
function strncmp(a, b, n) {
  a = cstr(a).slice(0, Math.max(0, Number(n) || 0));
  b = cstr(b).slice(0, Math.max(0, Number(n) || 0));
  return a < b ? -1 : a > b ? 1 : 0;
}
function strcpy(dst, src) {
  const value = cstr(src);
  if (isMemory(dst) || (dst && dst.__browc_ptr)) {
    writeCString(dst, value);
    return dst;
  }
  return value;
}
function strncpy(dst, src, n) {
  const value = cstr(src);
  n = Math.max(0, Number(n) || 0);
  if (isMemory(dst) || (dst && dst.__browc_ptr)) {
    const d = checkedMemory(dst);
    const bytes = utf8(value);
    const limit = Math.min(n, d.memory.length - d.offset);
    if (limit > 0) {
      d.memory.fill(0, d.offset, d.offset + limit);
      d.memory.set(bytes.slice(0, limit), d.offset);
    }
    return dst;
  }
  return value.slice(0, n);
}
function strcat(dst, src) {
  const value = cstr(dst) + cstr(src);
  if (isMemory(dst) || (dst && dst.__browc_ptr)) {
    writeCString(dst, value);
    return dst;
  }
  return value;
}
function strncat(dst, src, n) {
  const value = cstr(dst) + cstr(src).slice(0, Math.max(0, Number(n) || 0));
  if (isMemory(dst) || (dst && dst.__browc_ptr)) {
    writeCString(dst, value);
    return dst;
  }
  return value;
}
function strchr(s, c) {
  const str = cstr(s);
  const ch = String.fromCharCode(Number(c) & 0xff);
  const i = str.indexOf(ch);
  return i < 0 ? null : str.slice(i);
}
function strrchr(s, c) {
  const str = cstr(s);
  const ch = String.fromCharCode(Number(c) & 0xff);
  const i = str.lastIndexOf(ch);
  return i < 0 ? null : str.slice(i);
}
function strstr(haystack, needle) {
  const s = cstr(haystack);
  const n = cstr(needle);
  const i = s.indexOf(n);
  return i < 0 ? null : s.slice(i);
}
function strpbrk(s, accept) {
  const str = cstr(s);
  const chars = cstr(accept);
  for (let i = 0; i < str.length; i++) {
    if (chars.includes(str[i])) return str.slice(i);
  }
  return null;
}
function strspn(s, accept) {
  const str = cstr(s);
  const chars = cstr(accept);
  let i = 0;
  while (i < str.length && chars.includes(str[i])) i++;
  return i;
}
function strcspn(s, reject) {
  const str = cstr(s);
  const chars = cstr(reject);
  let i = 0;
  while (i < str.length && !chars.includes(str[i])) i++;
  return i;
}
function strtok(s, delimiters) {
  if (!globalThis.__BROWC_STRTOK__) {
    globalThis.__BROWC_STRTOK__ = {
      text: "",
      position: 0,
      done: true,
    };
  }
  const state = globalThis.__BROWC_STRTOK__;
  if (s != null) {
    state.text = cstr(s);
    state.position = 0;
    state.done = false;
  }
  if (state.done) return null;
  const d = cstr(delimiters);
  while (
    state.position < state.text.length &&
    d.includes(state.text[state.position])
  ) {
    state.position++;
  }
  if (state.position >= state.text.length) {
    state.done = true;
    return null;
  }
  const start = state.position;
  while (
    state.position < state.text.length &&
    !d.includes(state.text[state.position])
  ) {
    state.position++;
  }
  return state.text.slice(start, state.position);
}
function memcopy(dst, src, n) {
  const d = checkedMemory(dst);
  const s = src instanceof Uint8Array ? src : memoryRead(src, n);
  const count = Math.min(
    Math.max(0, Number(n) || 0),
    d.memory.length - d.offset,
    s.length
  );
  d.memory.set(s.slice(0, count), d.offset);
  return dst;
}
function memmove(dst, src, n) {
  const bytes = memoryRead(src, n);
  return memcopy(dst, bytes, bytes.length);
}
function memset(dst, value, n) {
  const d = checkedMemory(dst);
  const count = Math.min(
    Math.max(0, Number(n) || 0),
    d.memory.length - d.offset
  );
  d.memory.fill(Number(value) & 0xff, d.offset, d.offset + count);
  return dst;
}
function memcmp(a, b, n) {
  const aa = memoryRead(a, n);
  const bb = memoryRead(b, n);
  const count = Math.max(0, Number(n) || 0);
  for (let i = 0; i < count; i++) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
function memchr(memory, value, n) {
  const m = memoryRead(memory, n);
  const target = Number(value) & 0xff;
  for (let i = 0; i < m.length; i++) {
    if (m[i] === target) return pointerOffset(memory, i);
  }
  return null;
}
function memccpy(dst, src, c, n) {
  const source = memoryRead(src, n);
  const target = Number(c) & 0xff;
  for (let i = 0; i < source.length; i++) {
    memcopy(pointerOffset(dst, i), source.slice(i, i + 1), 1);
    if (source[i] === target) return pointerOffset(dst, i + 1);
  }
  return null;
}
function memmem(haystack, hs, needle, ns) {
  const h = memoryRead(haystack, hs);
  const n = memoryRead(needle, ns);
  if (n.length === 0) return haystack;
  outer: for (let i = 0; i + n.length <= h.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (h[i + j] !== n[j]) continue outer;
    }
    return pointerOffset(haystack, i);
  }
  return null;
}
/* ========================================================================
 * CTYPE
 * ====================================================================== */
function cChar(c) {
  return String.fromCharCode(Number(c) & 0xff);
}
const ctype = {
  isalnum: (c) => (/[A-Za-z0-9]/.test(cChar(c)) ? 1 : 0),
  isalpha: (c) => (/[A-Za-z]/.test(cChar(c)) ? 1 : 0),
  isblank: (c) => (/^[ \t]$/.test(cChar(c)) ? 1 : 0),
  iscntrl: (c) => {
    const x = Number(c);
    return x >= 0 && x < 32 ? 1 : 0;
  },
  isdigit: (c) => (/[0-9]/.test(cChar(c)) ? 1 : 0),
  isgraph: (c) => (/^[\x21-\x7E]$/.test(cChar(c)) ? 1 : 0),
  islower: (c) => (/[a-z]/.test(cChar(c)) ? 1 : 0),
  isprint: (c) => (/^[\x20-\x7E]$/.test(cChar(c)) ? 1 : 0),
  ispunct: (c) =>
    /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/.test(cChar(c)) ? 1 : 0,
  isspace: (c) => (/^\s$/.test(cChar(c)) ? 1 : 0),
  isupper: (c) => (/[A-Z]/.test(cChar(c)) ? 1 : 0),
  isxdigit: (c) => (/[0-9A-Fa-f]/.test(cChar(c)) ? 1 : 0),
  isascii: (c) => (Number(c) >= 0 && Number(c) <= 127 ? 1 : 0),
  toascii: (c) => Number(c) & 0x7f,
  tolower: (c) => cChar(c).toLowerCase().charCodeAt(0),
  toupper: (c) => cChar(c).toUpperCase().charCodeAt(0),
};
for (const [name, fn] of Object.entries(ctype)) {
  ctype[`${name}_l`] = fn;
}
/* ========================================================================
 * MATH
 * ====================================================================== */
function gamma(z) {
  const p = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  }
  z -= 1;
  let x = 0.9999999999998099;
  for (let i = 0; i < p.length; i++) {
    x += p[i] / (z + i + 1);
  }
  const t = z + p.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}
const math = {
  sin: (x) => Math.sin(Number(x)),
  cos: (x) => Math.cos(Number(x)),
  tan: (x) => Math.tan(Number(x)),
  asin: (x) => Math.asin(Number(x)),
  acos: (x) => Math.acos(Number(x)),
  atan: (x) => Math.atan(Number(x)),
  atan2: (y, x) => Math.atan2(Number(y), Number(x)),
  sinh: (x) => Math.sinh(Number(x)),
  cosh: (x) => Math.cosh(Number(x)),
  tanh: (x) => Math.tanh(Number(x)),
  asinh: (x) => Math.asinh(Number(x)),
  acosh: (x) => Math.acosh(Number(x)),
  atanh: (x) => Math.atanh(Number(x)),
  exp: (x) => Math.exp(Number(x)),
  exp2: (x) => 2 ** Number(x),
  expm1: (x) => Math.expm1(Number(x)),
  log: (x) => Math.log(Number(x)),
  log10: (x) => Math.log10(Number(x)),
  log2: (x) => Math.log2(Number(x)),
  log1p: (x) => Math.log1p(Number(x)),
  pow: (x, y) => Math.pow(Number(x), Number(y)),
  sqrt: (x) => Math.sqrt(Number(x)),
  cbrt: (x) => Math.cbrt(Number(x)),
  hypot: (...x) => Math.hypot(...x.map(Number)),
  ceil: (x) => Math.ceil(Number(x)),
  floor: (x) => Math.floor(Number(x)),
  trunc: (x) => Math.trunc(Number(x)),
  round: (x) => Math.round(Number(x)),
  nearbyint: (x) => Math.round(Number(x)),
  rint: (x) => Math.round(Number(x)),
  fmod: (x, y) => Number(x) % Number(y),
  remainder: (x, y) => {
    x = Number(x);
    y = Number(y);
    return y === 0 ? NaN : x - y * Math.round(x / y);
  },
  fabs: (x) => Math.abs(Number(x)),
  fdim: (x, y) => Math.max(Number(x) - Number(y), 0),
  fmax: (x, y) => Math.max(Number(x), Number(y)),
  fmin: (x, y) => Math.min(Number(x), Number(y)),
  copysign: (x, y) => Math.abs(Number(x)) * (Number(y) < 0 ? -1 : 1),
  ldexp: (x, e) => Number(x) * 2 ** Number(e),
  scalbn: (x, n) => Number(x) * 2 ** Number(n),
  scalbln: (x, n) => Number(x) * 2 ** Number(n),
  ilogb: (x) => Math.floor(Math.log2(Math.abs(Number(x)))),
  logb: (x) => Math.log2(Math.abs(Number(x))),
  nextafter: (x, y) => {
    x = Number(x);
    y = Number(y);
    if (x === y) return y;
    const step = Math.max(Number.EPSILON * Math.abs(x || 1), Number.MIN_VALUE);
    return x < y ? x + step : x - step;
  },
  erf,
  erfc: (x) => 1 - erf(Number(x)),
  tgamma: (x) => gamma(Number(x)),
  lgamma: (x) => Math.log(Math.abs(gamma(Number(x)))),
  fma: (x, y, z) => Number(x) * Number(y) + Number(z),
  nan: () => NaN,
};
math.frexp = function (x, expPtr = null) {
  x = Number(x);
  if (x === 0) {
    if (expPtr) writeInt(expPtr, 0);
    return 0;
  }
  const exponent = Math.floor(Math.log2(Math.abs(x))) + 1;
  if (expPtr) writeInt(expPtr, exponent);
  return x / 2 ** exponent;
};
math.modf = function (x, iptr = null) {
  x = Number(x);
  const integer = Math.trunc(x);
  if (iptr) writeFloat64(iptr, integer);
  return x - integer;
};
function writeInt(ptr, value) {
  const d = checkedMemory(ptr);
  new DataView(
    d.memory.buffer,
    d.memory.byteOffset,
    d.memory.byteLength
  ).setInt32(d.offset, Number(value) | 0, true);
}
function readInt(ptr) {
  const d = checkedMemory(ptr);
  return new DataView(
    d.memory.buffer,
    d.memory.byteOffset,
    d.memory.byteLength
  ).getInt32(d.offset, true);
}
function writeFloat64(ptr, value) {
  const d = checkedMemory(ptr);
  new DataView(
    d.memory.buffer,
    d.memory.byteOffset,
    d.memory.byteLength
  ).setFloat64(d.offset, Number(value), true);
}
function readFloat64(ptr) {
  const d = checkedMemory(ptr);
  return new DataView(
    d.memory.buffer,
    d.memory.byteOffset,
    d.memory.byteLength
  ).getFloat64(d.offset, true);
}
/* ========================================================================
 * TIME
 * ====================================================================== */
function time(timerPtr = null) {
  const seconds = Math.floor(Date.now() / 1000);
  if (timerPtr) writeFloat64(timerPtr, seconds);
  return seconds;
}
function localtimeCommon(seconds, utc = false) {
  const date = new Date(Number(seconds) * 1000);
  const tm = {
    tm_sec: utc ? date.getUTCSeconds() : date.getSeconds(),
    tm_min: utc ? date.getUTCMinutes() : date.getMinutes(),
    tm_hour: utc ? date.getUTCHours() : date.getHours(),
    tm_mday: utc ? date.getUTCDate() : date.getDate(),
    tm_mon: utc ? date.getUTCMonth() : date.getMonth(),
    tm_year: (utc ? date.getUTCFullYear() : date.getFullYear()) - 1900,
    tm_wday: utc ? date.getUTCDay() : date.getDay(),
    tm_yday: Math.floor(
      (date.getTime() -
        new Date(
          utc ? date.getUTCFullYear() : date.getFullYear(),
          0,
          1
        ).getTime()) /
        86400000
    ),
    tm_isdst: 0,
  };
  return tm;
}
function mktime(tm) {
  if (!tm) return -1;
  const date = new Date(
    Number(tm.tm_year) + 1900,
    Number(tm.tm_mon),
    Number(tm.tm_mday),
    Number(tm.tm_hour),
    Number(tm.tm_min),
    Number(tm.tm_sec)
  );
  return Math.floor(date.getTime() / 1000);
}
function strftime(ptr, max, format, tm) {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const shortMonths = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const date = new Date(
    Number(tm?.tm_year ?? 70) + 1900,
    Number(tm?.tm_mon ?? 0),
    Number(tm?.tm_mday ?? 1),
    Number(tm?.tm_hour ?? 0),
    Number(tm?.tm_min ?? 0),
    Number(tm?.tm_sec ?? 0)
  );
  const p2 = (n) => String(n).padStart(2, "0");
  const out = cstr(format).replace(
    /%[aAbBcdDeHImMpRStTuUwWxXyY%]/g,
    (token) => {
      switch (token) {
        case "%%":
          return "%";
        case "%a":
          return shortDays[date.getDay()];
        case "%A":
          return days[date.getDay()];
        case "%b":
        case "%h":
          return shortMonths[date.getMonth()];
        case "%B":
          return months[date.getMonth()];
        case "%c":
          return date.toString();
        case "%d":
          return p2(date.getDate());
        case "%D":
          return `${p2(date.getMonth() + 1)}/${p2(date.getDate())}/${String(
            date.getFullYear()
          ).slice(-2)}`;
        case "%e":
          return String(date.getDate()).padStart(2, " ");
        case "%F":
          return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(
            date.getDate()
          )}`;
        case "%H":
          return p2(date.getHours());
        case "%I":
          return p2(((date.getHours() + 11) % 12) + 1);
        case "%j":
          return String(
            Math.floor((date - new Date(date.getFullYear(), 0, 1)) / 86400000) +
              1
          ).padStart(3, "0");
        case "%m":
          return p2(date.getMonth() + 1);
        case "%M":
          return p2(date.getMinutes());
        case "%p":
          return date.getHours() >= 12 ? "PM" : "AM";
        case "%R":
          return `${p2(date.getHours())}:${p2(date.getMinutes())}`;
        case "%S":
          return p2(date.getSeconds());
        case "%T":
          return `${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(
            date.getSeconds()
          )}`;
        case "%u":
          return String(date.getDay() || 7);
        case "%w":
          return String(date.getDay());
        case "%x":
          return date.toLocaleDateString();
        case "%X":
          return date.toLocaleTimeString();
        case "%y":
          return String(date.getFullYear() % 100).padStart(2, "0");
        case "%Y":
          return String(date.getFullYear());
        case "%Z":
          return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        default:
          return token;
      }
    }
  );
  if (ptr) writeCString(ptr, out, Number(max) || 0);
  return out.length;
}
/* ========================================================================
 * LOCALE
 * ====================================================================== */
let currentLocale = "C";
function setlocale(category, locale) {
  if (locale == null) return currentLocale;
  locale = cstr(locale);
  currentLocale = locale || "C";
  return currentLocale;
}
const lconv = {
  decimal_point: ".",
  thousands_sep: "",
  grouping: "",
  int_curr_symbol: "",
  currency_symbol: "",
  mon_decimal_point: ".",
  mon_thousands_sep: "",
  mon_grouping: "",
  positive_sign: "",
  negative_sign: "-",
  int_frac_digits: 0,
  frac_digits: 0,
  p_cs_precedes: 1,
  p_sep_by_space: 0,
  n_cs_precedes: 1,
  n_sep_by_space: 0,
  p_sign_posn: 1,
  n_sign_posn: 1,
};
/* ========================================================================
 * ASSERT / SIGNAL / SETJMP / FENV
 * ====================================================================== */
function assertC(
  expression,
  exprText = "expression is false",
  file = "<browc>",
  line = 0,
  fn = ""
) {
  if (!Number(expression)) {
    const message = `Assertion failed: ${exprText} at ${file}:${line} (${fn})`;
    console.error(message);
    throw new Error(message);
  }
  return 0;
}
const signalHandlers = new Map();
function signalC(sig, handler) {
  const previous = signalHandlers.get(Number(sig)) || null;
  signalHandlers.set(Number(sig), handler);
  return previous;
}
function raiseC(sig) {
  const handler = signalHandlers.get(Number(sig));
  if (typeof handler === "function") {
    handler(Number(sig));
    return 0;
  }
  return 0;
}
/*
 * setjmp/longjmp require compiler control-flow cooperation. We expose
 * a BrowC runtime object so the AST executor can implement non-local
 * jumps without pretending that JavaScript exceptions are C stack frames.
 */
function setjmpC(env) {
  if (env && typeof env === "object") {
    env.__browc_setjmp_value = 0;
    env.__browc_valid = true;
  }
  return 0;
}
function longjmpC(env, value) {
  const v = Number(value) || 1;
  if (runtime() && typeof runtime().longjmp === "function") {
    return runtime().longjmp(env, v);
  }
  const error = new Error(`BrowC longjmp(${v})`);
  error.__browc_longjmp = true;
  error.__browc_env = env;
  error.__browc_value = v;
  throw error;
}
const fenv = {
  FE_DFL_ENV: 0,
  FE_DOWNWARD: 0x400,
  FE_TONEAREST: 0,
  FE_TOWARDZERO: 0xc00,
  FE_UPWARD: 0x800,
  FE_DIVBYZERO: 4,
  FE_INEXACT: 32,
  FE_INVALID: 1,
  FE_OVERFLOW: 8,
  FE_UNDERFLOW: 16,
  fetestexcept: () => 0,
  feclearexcept: () => 0,
  feraiseexcept: () => 0,
  fegetround: () => 0,
  fesetround: () => 0,
  fegetenv: () => 0,
  feholdexcept: () => 0,
  fesetenv: () => 0,
  feupdateenv: () => 0,
};
/* ========================================================================
 * STDARG
 * ====================================================================== */
function vaStart(values) {
  const args = Array.isArray(values) ? values : [];
  return {
    __browc_va_list: true,
    args,
    index: 0,
  };
}
function vaArg(ap) {
  if (!ap || !ap.__browc_va_list) {
    throw new Error("BrowC invalid va_list");
  }
  return ap.args[ap.index++];
}
function vaEnd(ap) {
  if (ap) ap.index = ap.args.length;
}
function vaCopy(dst, src) {
  if (!dst || !src) return;
  dst.__browc_va_list = true;
  dst.args = src.args.slice();
  dst.index = src.index;
}
/* ========================================================================
 * COMPLEX
 * ====================================================================== */
function complex(re = 0, im = 0) {
  return { re: Number(re), im: Number(im), __browc_complex: true };
}
function isComplex(z) {
  return !!(z && z.__browc_complex);
}
function complexify(z) {
  return isComplex(z) ? z : complex(Number(z), 0);
}
const complexMath = {
  creal: (z) => complexify(z).re,
  cimag: (z) => complexify(z).im,
  cabs: (z) => Math.hypot(complexify(z).re, complexify(z).im),
  carg: (z) => Math.atan2(complexify(z).im, complexify(z).re),
  conj: (z) => {
    z = complexify(z);
    return complex(z.re, -z.im);
  },
  cproj: (z) => complexify(z),
  cexp: (z) => {
    z = complexify(z);
    const e = Math.exp(z.re);
    return complex(e * Math.cos(z.im), e * Math.sin(z.im));
  },
  clog: (z) => {
    z = complexify(z);
    return complex(Math.log(Math.hypot(z.re, z.im)), Math.atan2(z.im, z.re));
  },
  csqrt: (z) => {
    z = complexify(z);
    const r = Math.hypot(z.re, z.im);
    const a = Math.sqrt((r + z.re) / 2);
    const b = Math.sqrt((r - z.re) / 2) * (z.im < 0 ? -1 : 1);
    return complex(a, b);
  },
  cpow: (a, b) => {
    a = complexify(a);
    b = complexify(b);
    const r = Math.hypot(a.re, a.im);
    const theta = Math.atan2(a.im, a.re);
    const lnR = Math.log(r);
    const real = b.re * lnR - b.im * theta;
    const imag = b.re * theta + b.im * lnR;
    const mag = Math.exp(real);
    return complex(mag * Math.cos(imag), mag * Math.sin(imag));
  },
};
/* aliases for common complex functions */
for (const name of [
  "sin",
  "cos",
  "tan",
  "sinh",
  "cosh",
  "tanh",
  "asin",
  "acos",
  "atan",
]) {
  complexMath[`c${name}`] = (z) => {
    z = complexify(z);
    /*
     * Runtime hook for exact complex implementations. This object is
     * intentionally kept extensible rather than giving fake scalar results.
     */
    if (runtime() && typeof runtime().complexMath?.[name] === "function") {
      return runtime().complexMath[name](z);
    }
    throw new Error(
      `BrowC complex function c${name} requires runtime complexMath.${name}`
    );
  };
}
/* ========================================================================
 * BROWSER API
 * ====================================================================== */
function browserBody() {
  return hasDocument() ? document.body : null;
}
function browserHead() {
  return hasDocument() ? document.head : null;
}
function createelement(tag) {
  return hasDocument() ? document.createElement(cstr(tag)) : null;
}
function createelement_ns(ns, tag) {
  return hasDocument() ? document.createElementNS(cstr(ns), cstr(tag)) : null;
}
function getelementbyid(id) {
  return hasDocument() ? document.getElementById(cstr(id)) : null;
}
function queryselector(selector) {
  return hasDocument() ? document.querySelector(cstr(selector)) : null;
}
function queryselectorall(selector) {
  return hasDocument()
    ? Array.from(document.querySelectorAll(cstr(selector)))
    : [];
}
function appendchild(parent, child) {
  return parent?.appendChild(child) ?? null;
}
function prependchild(parent, child) {
  if (!parent || !child) return null;
  parent.prepend(child);
  return child;
}
function insertbefore(parent, child, reference) {
  return parent?.insertBefore(child, reference) ?? null;
}
function removechild(parent, child) {
  return parent?.removeChild(child) ?? null;
}
function replacechild(parent, child, oldChild) {
  return parent?.replaceChild(child, oldChild) ?? null;
}
function parentnode(element) {
  return element?.parentNode ?? null;
}
function firstchild(element) {
  return element?.firstChild ?? null;
}
function lastchild(element) {
  return element?.lastChild ?? null;
}
function nextsibling(element) {
  return element?.nextSibling ?? null;
}
function previoussibling(element) {
  return element?.previousSibling ?? null;
}
function childCount(element) {
  return element?.childNodes?.length ?? 0;
}
function setattribute(element, name, value) {
  element?.setAttribute(cstr(name), cstr(value));
  return 0;
}
function getattribute(element, name) {
  return element?.getAttribute(cstr(name)) ?? null;
}
function removeattribute(element, name) {
  element?.removeAttribute(cstr(name));
  return 0;
}
function hasattribute(element, name) {
  return element?.hasAttribute(cstr(name)) ? 1 : 0;
}
function setText(element, text) {
  if (element) element.textContent = cstr(text);
  return 0;
}
function getText(element) {
  return element?.textContent ?? "";
}
function setInnerHTML(element, html) {
  if (element) element.innerHTML = cstr(html);
  return 0;
}
function getInnerHTML(element) {
  return element?.innerHTML ?? "";
}
function setValue(element, value) {
  if (element) element.value = cstr(value);
  return 0;
}
function getValue(element) {
  return element?.value ?? "";
}
function addClass(element, name) {
  element?.classList?.add(cstr(name));
  return 0;
}
function removeClass(element, name) {
  element?.classList?.remove(cstr(name));
  return 0;
}
function toggleClass(element, name) {
  return element?.classList?.toggle(cstr(name)) ? 1 : 0;
}
function hasClass(element, name) {
  return element?.classList?.contains(cstr(name)) ? 1 : 0;
}
function setStyle(element, property, value) {
  if (element) element.style[cstr(property)] = cstr(value);
  return 0;
}
function getStyle(element, property) {
  if (!element) return "";
  return getComputedStyle(element)[cstr(property)] || "";
}
function setChecked(element, checked) {
  if (element) element.checked = !!Number(checked);
  return 0;
}
function getChecked(element) {
  return element?.checked ? 1 : 0;
}
function setDisabled(element, disabled) {
  if (element) element.disabled = !!Number(disabled);
  return 0;
}
function getDisabled(element) {
  return element?.disabled ? 1 : 0;
}
function focus(element) {
  element?.focus?.();
  return 0;
}
function blur(element) {
  element?.blur?.();
  return 0;
}
function click(element) {
  element?.click?.();
  return 0;
}
function addEventListenerC(element, type, callback) {
  element?.addEventListener?.(cstr(type), callback);
  return 0;
}
function removeEventListenerC(element, type, callback) {
  element?.removeEventListener?.(cstr(type), callback);
  return 0;
}
function dispatchEventC(element, type) {
  if (!element?.dispatchEvent) return -1;
  const event = new Event(cstr(type), {
    bubbles: true,
    cancelable: true,
  });
  return element.dispatchEvent(event) ? 1 : 0;
}
function browserLocation() {
  return hasWindow() ? location.href : "";
}
function browserOrigin() {
  return hasWindow() ? location.origin : "";
}
function browserHostname() {
  return hasWindow() ? location.hostname : "";
}
function browserHost() {
  return hasWindow() ? location.host : "";
}
function browserProtocol() {
  return hasWindow() ? location.protocol : "";
}
function browserPathname() {
  return hasWindow() ? location.pathname : "";
}
function browserSearch() {
  return hasWindow() ? location.search : "";
}
function browserHash() {
  return hasWindow() ? location.hash : "";
}
function browserNavigate(url) {
  if (hasWindow()) location.href = cstr(url);
  return 0;
}
function browserReload() {
  if (hasWindow()) location.reload();
  return 0;
}
function browserBack() {
  if (hasWindow()) history.back();
  return 0;
}
function browserForward() {
  if (hasWindow()) history.forward();
  return 0;
}
function browserScrollTo(x, y) {
  if (hasWindow()) window.scrollTo(Number(x) || 0, Number(y) || 0);
  return 0;
}
function browserScrollBy(x, y) {
  if (hasWindow()) window.scrollBy(Number(x) || 0, Number(y) || 0);
  return 0;
}
function browserWidth() {
  return hasWindow() ? innerWidth : 0;
}
function browserHeight() {
  return hasWindow() ? innerHeight : 0;
}
function browserTitleGet() {
  return hasDocument() ? document.title : "";
}
function browserTitleSet(title) {
  if (hasDocument()) document.title = cstr(title);
  return 0;
}
/* timers */
function setTimeoutC(callback, ms) {
  return setTimeout(
    typeof callback === "function" ? callback : () => {},
    Math.max(0, Number(ms) || 0)
  );
}
function setIntervalC(callback, ms) {
  return setInterval(
    typeof callback === "function" ? callback : () => {},
    Math.max(0, Number(ms) || 0)
  );
}
/* storage */
function storageGet(storage, key) {
  if (!storage) return null;
  return storage.getItem(cstr(key));
}
function storageSet(storage, key, value) {
  if (!storage) return -1;
  storage.setItem(cstr(key), cstr(value));
  return 0;
}
function storageRemove(storage, key) {
  if (!storage) return -1;
  storage.removeItem(cstr(key));
  return 0;
}
function storageClear(storage) {
  if (!storage) return -1;
  storage.clear();
  return 0;
}
/* cookies */
function browserSetCookie(name, value, maxAge = null, path = "/") {
  if (!hasDocument()) return -1;
  let cookie = `${encodeURIComponent(cstr(name))}=${encodeURIComponent(
    cstr(value)
  )}; path=${path}`;
  if (maxAge != null) cookie += `; max-age=${Number(maxAge)}`;
  document.cookie = cookie;
  return 0;
}
function browserGetCookie(name) {
  if (!hasDocument()) return null;
  const wanted = cstr(name);
  for (const part of document.cookie.split(";")) {
    const text = part.trim();
    const i = text.indexOf("=");
    if (i < 0) continue;
    const n = decodeURIComponent(text.slice(0, i));
    if (n === wanted) {
      return decodeURIComponent(text.slice(i + 1));
    }
  }
  return null;
}
function browserDeleteCookie(name) {
  return browserSetCookie(name, "", 0, "/");
}
/* JSON / encoding */
function jsonStringify(value) {
  return JSON.stringify(value);
}
function jsonParse(value) {
  return JSON.parse(cstr(value));
}
function base64Encode(value) {
  const bytes = utf8(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64Decode(value) {
  const binary = atob(cstr(value));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
/* network */
async function webFetch(url, options = undefined) {
  return fetch(cstr(url), options);
}
async function webFetchText(url, options = undefined) {
  const response = await fetch(cstr(url), options);
  return response.text();
}
async function webFetchJSON(url, options = undefined) {
  const response = await fetch(cstr(url), options);
  return response.json();
}
async function webFetchBinary(url, options = undefined) {
  const response = await fetch(cstr(url), options);
  return response.arrayBuffer();
}
async function webRequest(url, method, body, headers = {}) {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const normalizedHeaders = new Headers();
  if (headers && typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders.set(String(key), String(value));
    }
  }

  const requestState = {
    url: cstr(url),
    method: cstr(method || "GET").toUpperCase(),
    body: body == null ? undefined : cstr(body),
    headers: normalizedHeaders,
    controller,
    promise: null,
  };

  requestState.promise = fetch(requestState.url, {
    method: requestState.method,
    headers: requestState.headers,
    body: requestState.body,
    signal: controller?.signal,
  });

  return requestState.promise;
}
function webResponseText(response) {
  return response?.text?.();
}
function webResponseJSON(response) {
  return response?.json?.();
}
function webStatus(response) {
  return Number(response?.status || 0);
}
function webSetHeader(request, name, value) {
  if (!request) return -1;
  try {
    if (request.headers?.set) {
      request.headers.set(cstr(name), cstr(value));
      return 0;
    }
    if (!request.__browc_headers) request.__browc_headers = new Headers();
    request.__browc_headers.set(cstr(name), cstr(value));
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}
function webAbort(request) {
  request?.__browc_controller?.abort?.();
  return 0;
}
/* websocket */
function websocketConnect(url) {
  if (!hasWindow()) return null;
  return new WebSocket(cstr(url));
}
function websocketSend(socket, message) {
  if (!socket || typeof socket.send !== "function") return -1;
  if (socket.readyState !== 1) return -1;
  try {
    socket.send(cstr(message));
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EPIPE);
  }
}
function websocketSendBinary(socket, data, length) {
  if (!socket || typeof socket.send !== "function" || socket.readyState !== 1)
    return -1;
  try {
    if (data instanceof ArrayBuffer) {
      socket.send(data.slice(0, Number(length) || data.byteLength));
    } else if (ArrayBuffer.isView(data)) {
      const n = Number(length);
      socket.send(
        n >= 0
          ? data.buffer.slice(
              data.byteOffset,
              data.byteOffset + Math.min(n, data.byteLength)
            )
          : data
      );
    } else {
      socket.send(data);
    }
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EPIPE);
  }
}
function websocketClose(socket) {
  socket?.close?.();
  return 0;
}
function websocketIsOpen(socket) {
  return socket?.readyState === 1 ? 1 : 0;
}
function websocketReadyState(socket) {
  return Number(socket?.readyState ?? -1);
}
function websocketSetHandlers(socket, onopen, onmessage, onerror, onclose) {
  if (!socket) return -1;
  try {
    socket.onopen = typeof onopen === "function" ? onopen : null;
    socket.onmessage = typeof onmessage === "function" ? onmessage : null;
    socket.onerror = typeof onerror === "function" ? onerror : null;
    socket.onclose = typeof onclose === "function" ? onclose : null;
    return 0;
  } catch (_) {
    return -1;
  }
}
/* canvas */
function canvasCreate(element) {
  return element?.getContext?.("2d") ?? null;
}
function canvasGetContext(canvas, type) {
  return canvas?.getContext?.(cstr(type)) ?? null;
}
function canvasClear(ctx) {
  if (!ctx?.canvas) return 0;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  return 0;
}
function canvasSetFillStyle(ctx, style) {
  if (ctx) ctx.fillStyle = cstr(style);
  return 0;
}
function canvasSetStrokeStyle(ctx, style) {
  if (ctx) ctx.strokeStyle = cstr(style);
  return 0;
}
function canvasSetLineWidth(ctx, width) {
  if (ctx) ctx.lineWidth = Number(width);
  return 0;
}
/* audio */
function audioCreate(url) {
  if (!hasDocument()) return null;
  return new Audio(cstr(url));
}
/* downloads */
function browserDownload(filename, content, mime = "application/octet-stream") {
  if (!hasDocument()) return -1;
  const blob = new Blob([String(content ?? "")], {
    type: cstr(mime) || "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = cstr(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 0;
}
/* system */
function browserSystem(command) {
  try {
    const source = cstr(command);
    if (runtime() && typeof runtime().system === "function") {
      const result = runtime().system(source);
      if (result !== undefined) return result;
    }
    const fn = new Function("globalThis", source);
    fn(globalThis);
    return 0;
  } catch (error) {
    fail(error, BROWC.errno.EIO);
    console.error(error);
    return -1;
  }
}

/* ============================================================================
 * EXTENDED BROWSER API
 * ============================================================================
 * Browser APIs are capability-based: unsupported APIs return null/-1 rather
 * than crashing the whole BrowC program. Permission-gated APIs are exposed as
 * native Promises.
 * ========================================================================== */

function __browcBrowserError(error, errno = BROWC.errno.EIO) {
  fail(error instanceof Error ? error : new Error(String(error)), errno);
  return -1;
}

function __browcRequireWindow(name) {
  if (!hasWindow()) {
    throw new Error(`${name}: Window API is unavailable in this environment`);
  }
  return window;
}

function __browcRequireDocument(name) {
  if (!hasDocument()) {
    throw new Error(`${name}: Document API is unavailable in this environment`);
  }
  return document;
}

function __browcRequireFunction(object, name) {
  if (!object || typeof object[name] !== "function") {
    throw new Error(`${name} is not supported by this browser`);
  }
  return object[name].bind(object);
}

function browserReplace(url) {
  try {
    __browcRequireWindow("browser_replace").location.replace(cstr(url));
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}

function browserOpen(url, target = "_blank") {
  try {
    return __browcRequireWindow("browser_open").open(cstr(url), cstr(target));
  } catch (e) {
    return null;
  }
}

function browserClose() {
  try {
    window.close();
    return 0;
  } catch (e) {
    return __browcBrowserError(e);
  }
}

function browserFocus() {
  try {
    window.focus();
    return 0;
  } catch (_) {
    return -1;
  }
}

function browserPrint() {
  try {
    window.print();
    return 0;
  } catch (e) {
    return __browcBrowserError(e);
  }
}

function browserAlert(message) {
  try {
    window.alert(cstr(message));
    return 0;
  } catch (_) {
    return -1;
  }
}

function browserConfirm(message) {
  try {
    return window.confirm(cstr(message)) ? 1 : 0;
  } catch (_) {
    return -1;
  }
}

function browserPrompt(message, defaultValue = "") {
  try {
    return window.prompt(cstr(message), cstr(defaultValue));
  } catch (_) {
    return null;
  }
}

function browserDevicePixelRatio() {
  return hasWindow() ? Number(window.devicePixelRatio || 1) : 1;
}

function browserOnline() {
  return hasWindow() && "onLine" in navigator ? (navigator.onLine ? 1 : 0) : 1;
}

function browserLanguage() {
  return hasWindow() ? String(navigator.language || "") : "";
}

function browserUserAgent() {
  return hasWindow() ? String(navigator.userAgent || "") : "";
}

function elementClone(element, deep = 1) {
  return element?.cloneNode ? element.cloneNode(!!Number(deep)) : null;
}

function elementContains(parent, child) {
  return parent?.contains ? (parent.contains(child) ? 1 : 0) : 0;
}

function elementEqual(a, b) {
  return a?.isEqualNode ? (a.isEqualNode(b) ? 1 : 0) : a === b ? 1 : 0;
}

function elementGeometry(element) {
  if (!element?.getBoundingClientRect) return null;
  return element.getBoundingClientRect();
}

function elementLeft(element) {
  return Number(elementGeometry(element)?.left || 0);
}
function elementTop(element) {
  return Number(elementGeometry(element)?.top || 0);
}
function elementWidth(element) {
  return Number(elementGeometry(element)?.width || 0);
}
function elementHeight(element) {
  return Number(elementGeometry(element)?.height || 0);
}

function elementScrollLeft(element) {
  return Number(element?.scrollLeft || 0);
}
function elementScrollTop(element) {
  return Number(element?.scrollTop || 0);
}

function elementSetScroll(element, x, y) {
  if (!element) return -1;
  try {
    element.scrollTo(Number(x) || 0, Number(y) || 0);
  } catch (_) {
    element.scrollLeft = Number(x) || 0;
    element.scrollTop = Number(y) || 0;
  }
  return 0;
}

function setOuterHTML(element, html) {
  if (!element) return -1;
  try {
    element.outerHTML = cstr(html);
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}

function insertAdjacentHTML(element, position, html) {
  if (!element?.insertAdjacentHTML) return -1;
  try {
    element.insertAdjacentHTML(cstr(position), cstr(html));
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}

function setHidden(element, value) {
  if (element) element.hidden = !!Number(value);
  return 0;
}
function getHidden(element) {
  return element?.hidden ? 1 : 0;
}
function setReadOnly(element, value) {
  if (element) element.readOnly = !!Number(value);
  return 0;
}
function setSelectedIndex(element, value) {
  if (element) element.selectedIndex = Number(value) | 0;
  return 0;
}
function getSelectedIndex(element) {
  return Number(element?.selectedIndex ?? -1);
}

function submitElement(element) {
  try {
    element?.requestSubmit?.();
    return 0;
  } catch (_) {
    try {
      element?.submit?.();
      return 0;
    } catch (_) {
      return -1;
    }
  }
}

function scrollIntoViewC(element) {
  try {
    element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return 0;
  } catch (_) {
    return -1;
  }
}

function eventCodeC(e) {
  return e?.code ?? "";
}
function eventPageX(e) {
  return Number(e?.pageX ?? 0);
}
function eventPageY(e) {
  return Number(e?.pageY ?? 0);
}
function eventOffsetX(e) {
  return Number(e?.offsetX ?? 0);
}
function eventOffsetY(e) {
  return Number(e?.offsetY ?? 0);
}
function eventButtons(e) {
  return Number(e?.buttons ?? 0);
}

function stopImmediatePropagationC(e) {
  try {
    e?.stopImmediatePropagation?.();
    return 0;
  } catch (_) {
    return -1;
  }
}

function requestIdleCallbackC(callback) {
  if (hasWindow() && typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(callback);
  }
  return setTimeoutC(() => {
    if (typeof callback === "function") {
      callback({ didTimeout: false, timeRemaining: () => 0 });
    }
  }, 1);
}

function cancelIdleCallbackC(id) {
  if (hasWindow() && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(Number(id));
  } else {
    clearTimeout(Number(id));
  }
  return 0;
}

function storageLength(storage) {
  try {
    return storage?.length ?? 0;
  } catch (_) {
    return 0;
  }
}

function storageKey(storage, index) {
  try {
    return storage?.key(Number(index) | 0) ?? null;
  } catch (_) {
    return null;
  }
}

/* --------------------------- File System Access ------------------------- */

function browserShowOpenFilePicker(multiple = false) {
  try {
    const fn = __browcRequireFunction(window, "showOpenFilePicker");
    return fn({ multiple: !!multiple });
  } catch (e) {
    return Promise.reject(e);
  }
}

function browserShowSaveFilePicker() {
  try {
    return __browcRequireFunction(window, "showSaveFilePicker")({});
  } catch (e) {
    return Promise.reject(e);
  }
}

function browserShowDirectoryPicker(mode = "read") {
  try {
    const fn = __browcRequireFunction(window, "showDirectoryPicker");
    return fn({ mode: mode === "readwrite" ? "readwrite" : "read" });
  } catch (e) {
    return Promise.reject(e);
  }
}

function fileGetFile(handle) {
  try {
    return Promise.resolve(__browcRequireFunction(handle, "getFile")());
  } catch (e) {
    return Promise.reject(e);
  }
}

function fileCreateWritable(handle) {
  try {
    return Promise.resolve(__browcRequireFunction(handle, "createWritable")());
  } catch (e) {
    return Promise.reject(e);
  }
}

function fileQueryPermission(handle, write) {
  try {
    return handle?.queryPermission
      ? handle.queryPermission({ mode: Number(write) ? "readwrite" : "read" })
      : Promise.reject(new Error("queryPermission is unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

function fileRequestPermission(handle, write) {
  try {
    return handle?.requestPermission
      ? handle.requestPermission({ mode: Number(write) ? "readwrite" : "read" })
      : Promise.reject(new Error("requestPermission is unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

function fileHandleName(handle) {
  return handle?.name ?? "";
}
function fileHandleKind(handle) {
  return handle?.kind ?? "";
}

function fileHandleIsSame(a, b) {
  try {
    return a?.isSameEntry ? a.isSameEntry(b) : Promise.resolve(a === b);
  } catch (e) {
    return Promise.reject(e);
  }
}

function directoryGetFile(directory, name, create = false) {
  try {
    return directory?.getFileHandle
      ? directory.getFileHandle(cstr(name), { create: !!Number(create) })
      : Promise.reject(new Error("getFileHandle is unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

function directoryGetDirectory(directory, name, create = false) {
  try {
    return directory?.getDirectoryHandle
      ? directory.getDirectoryHandle(cstr(name), { create: !!Number(create) })
      : Promise.reject(new Error("getDirectoryHandle is unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

function directoryRemoveEntry(directory, name, recursive = false) {
  try {
    return directory?.removeEntry
      ? directory.removeEntry(cstr(name), { recursive: !!Number(recursive) })
      : Promise.reject(new Error("removeEntry is unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

async function directoryEntries(directory) {
  if (!directory) throw new Error("directoryEntries: null directory handle");
  if (directory.entries) {
    const result = [];
    for await (const [name, handle] of directory.entries()) {
      result.push({ name, handle });
    }
    return result;
  }
  throw new Error("Directory iteration is unavailable");
}

function directoryResolve(directory, handle) {
  try {
    return directory?.resolve
      ? directory.resolve(handle)
      : Promise.reject(new Error("resolve is unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

function directoryHandleName(handle) {
  return handle?.name ?? "";
}

function storageGetDirectory() {
  try {
    return navigator?.storage?.getDirectory
      ? navigator.storage.getDirectory()
      : Promise.reject(
          new Error("StorageManager.getDirectory() is unavailable")
        );
  } catch (e) {
    return Promise.reject(e);
  }
}

async function blobText(blob) {
  if (!blob?.text) throw new Error("Blob.text() is unavailable");
  return blob.text();
}

async function blobArrayBuffer(blob) {
  if (!blob?.arrayBuffer) throw new Error("Blob.arrayBuffer() is unavailable");
  return blob.arrayBuffer();
}

async function fileText(handle) {
  const file = await fileGetFile(handle);
  return blobText(file);
}

async function fileArrayBuffer(handle) {
  const file = await fileGetFile(handle);
  return blobArrayBuffer(file);
}

function fileSize(file) {
  return Number(file?.size ?? 0);
}
function fileName(file) {
  return file?.name ?? "";
}
function fileType(file) {
  return file?.type ?? "";
}
function fileLastModified(file) {
  return Number(file?.lastModified ?? 0);
}

/* ------------------------------- Canvas --------------------------------- */

function canvasTransferToOffscreen(element) {
  try {
    return element?.transferControlToOffscreen
      ? element.transferControlToOffscreen()
      : null;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}

function canvasCreateOffscreen(width, height) {
  try {
    if (typeof OffscreenCanvas === "undefined") return null;
    return new OffscreenCanvas(
      Math.max(0, Number(width) | 0),
      Math.max(0, Number(height) | 0)
    );
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}

function canvasPathCall(ctx, method, ...args) {
  if (!ctx || typeof ctx[method] !== "function") return -1;
  try {
    ctx[method](...args.map(Number));
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}

function canvasBezier(ctx, ...args) {
  return canvasPathCall(ctx, "bezierCurveTo", ...args);
}
function canvasQuadratic(ctx, ...args) {
  return canvasPathCall(ctx, "quadraticCurveTo", ...args);
}
function canvasArcTo(ctx, ...args) {
  return canvasPathCall(ctx, "arcTo", ...args);
}

function canvasRectSafe(ctx, x, y, w, h) {
  return canvasPathCall(ctx, "rect", x, y, w, h);
}

function canvasFillRectSafe(ctx, x, y, w, h) {
  return canvasPathCall(ctx, "fillRect", x, y, w, h);
}

function canvasStrokeRectSafe(ctx, x, y, w, h) {
  return canvasPathCall(ctx, "strokeRect", x, y, w, h);
}

function canvasClearRectSafe(ctx, x, y, w, h) {
  return canvasPathCall(ctx, "clearRect", x, y, w, h);
}

function canvasFillTextSafe(ctx, text, x, y) {
  if (!ctx?.fillText) return -1;
  try {
    ctx.fillText(cstr(text), Number(x), Number(y));
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}

function canvasStrokeTextSafe(ctx, text, x, y) {
  if (!ctx?.strokeText) return -1;
  try {
    ctx.strokeText(cstr(text), Number(x), Number(y));
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}

function canvasSetNumericProperty(
  ctx,
  property,
  value,
  min = -Infinity,
  max = Infinity
) {
  if (!ctx) return -1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return -1;
  try {
    ctx[property] = n;
    return 0;
  } catch (_) {
    return -1;
  }
}

function canvasSetStringProperty(ctx, property, value) {
  if (!ctx) return -1;
  try {
    ctx[property] = cstr(value);
    return 0;
  } catch (_) {
    return -1;
  }
}

function canvasSetGlobalAlpha(ctx, value) {
  return canvasSetNumericProperty(ctx, "globalAlpha", value, 0, 1);
}

function canvasMeasureText(ctx, text) {
  try {
    return Number(ctx?.measureText?.(cstr(text))?.width || 0);
  } catch (_) {
    return 0;
  }
}

function canvasDrawImage(ctx, source, x, y, w, h) {
  if (!ctx?.drawImage || !source) return -1;
  try {
    if (w !== undefined && h !== undefined) {
      ctx.drawImage(source, Number(x), Number(y), Number(w), Number(h));
    } else {
      ctx.drawImage(source, Number(x), Number(y));
    }
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}

function canvasPutImageData(ctx, imageData, x, y) {
  if (!ctx?.putImageData || !imageData) return -1;
  try {
    ctx.putImageData(imageData, Number(x), Number(y));
    return 0;
  } catch (e) {
    return __browcBrowserError(e, BROWC.errno.EINVAL);
  }
}

function canvasGetImageData(ctx, x, y, w, h) {
  try {
    return (
      ctx?.getImageData?.(Number(x), Number(y), Number(w), Number(h)) ?? null
    );
  } catch (e) {
    __browcBrowserError(e, BROWC.errno.EINVAL);
    return null;
  }
}

function canvasToDataURL(element, mime = "image/png") {
  try {
    return element?.toDataURL ? element.toDataURL(cstr(mime)) : "";
  } catch (e) {
    __browcBrowserError(e, BROWC.errno.EINVAL);
    return "";
  }
}

function canvasToBlob(element, mime = "image/png") {
  try {
    if (!element?.toBlob)
      return Promise.reject(new Error("toBlob unavailable"));
    return new Promise((resolve, reject) => {
      try {
        element.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("Canvas toBlob failed")),
          cstr(mime)
        );
      } catch (e) {
        reject(e);
      }
    });
  } catch (e) {
    return Promise.reject(e);
  }
}

function canvasWidth(ctx) {
  return Number(ctx?.canvas?.width || 0);
}
function canvasHeight(ctx) {
  return Number(ctx?.canvas?.height || 0);
}

function canvasSetSize(element, width, height) {
  if (!element) return -1;
  const w = Number(width),
    h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 0 || h < 0) return -1;
  element.width = w;
  element.height = h;
  return 0;
}

function imageDataCreate(width, height) {
  try {
    if (typeof ImageData === "undefined") return null;
    return new ImageData(Number(width) | 0, Number(height) | 0);
  } catch (e) {
    return null;
  }
}

function imageBitmapFrom(source) {
  try {
    return typeof createImageBitmap === "function"
      ? createImageBitmap(source)
      : null;
  } catch (_) {
    return null;
  }
}

function imageBitmapDecode(source) {
  try {
    return typeof createImageBitmap === "function"
      ? createImageBitmap(source)
      : Promise.reject(new Error("createImageBitmap unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

function imageBitmapClose(value) {
  try {
    value?.close?.();
    return 0;
  } catch (_) {
    return -1;
  }
}

/* -------------------------------- Audio --------------------------------- */

function audioLoad(value) {
  try {
    value?.load?.();
    return 0;
  } catch (_) {
    return -1;
  }
}
function audioSetMuted(value, v) {
  if (value) value.muted = !!Number(v);
  return 0;
}
function audioDuration(value) {
  return Number(value?.duration ?? 0);
}
function audioPaused(value) {
  return value?.paused ? 1 : 0;
}
function audioEnded(value) {
  return value?.ended ? 1 : 0;
}
function audioSetPlaybackRate(value, rate) {
  if (!value) return -1;
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return -1;
  try {
    value.playbackRate = n;
    return 0;
  } catch (_) {
    return -1;
  }
}

/* ----------------------------- Media ------------------------------------ */

function mediaGetUserMedia(audioEnabled, videoEnabled) {
  try {
    if (!navigator?.mediaDevices?.getUserMedia) {
      return Promise.reject(new Error("getUserMedia unavailable"));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: !!Number(audioEnabled),
      video: !!Number(videoEnabled),
    });
  } catch (e) {
    return Promise.reject(e);
  }
}

function mediaGetDisplayMedia(audioEnabled, videoEnabled) {
  try {
    if (!navigator?.mediaDevices?.getDisplayMedia) {
      return Promise.reject(new Error("getDisplayMedia unavailable"));
    }
    return navigator.mediaDevices.getDisplayMedia({
      audio: !!Number(audioEnabled),
      video: videoEnabled ? true : undefined,
    });
  } catch (e) {
    return Promise.reject(e);
  }
}

function mediaEnumerateDevices() {
  try {
    return navigator?.mediaDevices?.enumerateDevices
      ? navigator.mediaDevices.enumerateDevices()
      : Promise.reject(new Error("enumerateDevices unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

function mediaStop(value) {
  try {
    if (value?.getTracks) for (const track of value.getTracks()) track.stop();
    else value?.stop?.();
    return 0;
  } catch (_) {
    return -1;
  }
}

/* ------------------------------ Clipboard ------------------------------- */

function clipboardReadText() {
  try {
    return navigator?.clipboard?.readText
      ? navigator.clipboard.readText()
      : Promise.reject(new Error("Clipboard readText unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

function clipboardWriteText(text) {
  try {
    return navigator?.clipboard?.writeText
      ? navigator.clipboard.writeText(cstr(text))
      : Promise.reject(new Error("Clipboard writeText unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

/* ----------------------------- Geolocation ------------------------------ */

function geolocationCurrentPosition() {
  return new Promise((resolve, reject) => {
    try {
      if (!navigator?.geolocation) {
        reject(new Error("Geolocation unavailable"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

const __browcGeoWatches = new Set();
function geolocationWatchPosition(callback) {
  try {
    if (!navigator?.geolocation) return -1;
    const id = navigator.geolocation.watchPosition(callback);
    __browcGeoWatches.add(id);
    return id;
  } catch (_) {
    return -1;
  }
}
function geolocationClearWatch(id) {
  try {
    navigator?.geolocation?.clearWatch?.(Number(id));
    __browcGeoWatches.delete(Number(id));
    return 0;
  } catch (_) {
    return -1;
  }
}

/* ---------------------------- Notifications ----------------------------- */

function notificationRequestPermission() {
  try {
    return typeof Notification !== "undefined"
      ? Notification.requestPermission()
      : Promise.reject(new Error("Notifications unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

function notificationPermissionGranted() {
  return typeof Notification !== "undefined" &&
    Notification.permission === "granted"
    ? 1
    : 0;
}

function browserNotify(title, body = "") {
  try {
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return -1;
    new Notification(cstr(title), { body: cstr(body) });
    return 0;
  } catch (e) {
    return __browcBrowserError(e);
  }
}

/* -------------------------------- Workers -------------------------------- */

function workerCreate(url) {
  try {
    return typeof Worker !== "undefined" ? new Worker(cstr(url)) : null;
  } catch (_) {
    return null;
  }
}

function workerPostMessage(value, message) {
  try {
    value?.postMessage?.(message);
    return 0;
  } catch (_) {
    return -1;
  }
}
function workerTerminate(value) {
  try {
    value?.terminate?.();
    return 0;
  } catch (_) {
    return -1;
  }
}

function workerSetHandlers(value, onmessage, onerror) {
  if (!value) return -1;
  try {
    value.onmessage = typeof onmessage === "function" ? onmessage : null;
    value.onerror = typeof onerror === "function" ? onerror : null;
    return 0;
  } catch (_) {
    return -1;
  }
}

/* -------------------------------- Crypto -------------------------------- */

function cryptoRandomUUID() {
  try {
    if (globalThis.crypto?.randomUUID)
      return Promise.resolve(globalThis.crypto.randomUUID());
    return Promise.reject(new Error("crypto.randomUUID unavailable"));
  } catch (e) {
    return Promise.reject(e);
  }
}

async function cryptoDigest(algorithm, data, length) {
  if (!globalThis.crypto?.subtle?.digest)
    throw new Error("Web Crypto digest unavailable");
  let input;
  if (data instanceof ArrayBuffer)
    input = data.slice(0, Number(length) || data.byteLength);
  else if (ArrayBuffer.isView(data))
    input = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + (Number(length) || data.byteLength)
    );
  else input = utf8(cstr(data));
  return globalThis.crypto.subtle.digest(cstr(algorithm), input);
}

function cryptoRandomBytes(length) {
  const n = Number(length);
  if (!Number.isInteger(n) || n < 0 || n > 65536) {
    return Promise.reject(
      new RangeError("crypto_random_bytes length must be 0..65536")
    );
  }
  try {
    const out = new Uint8Array(n);
    globalThis.crypto.getRandomValues(out);
    return Promise.resolve(out);
  } catch (e) {
    return Promise.reject(e);
  }
}

/* ------------------------------ Observers -------------------------------- */

function mutationObserverCreate(callback) {
  try {
    return typeof MutationObserver !== "undefined"
      ? new MutationObserver(callback)
      : null;
  } catch (_) {
    return null;
  }
}
function mutationObserverObserve(observerValue, target) {
  try {
    observerValue?.observe?.(target, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    return 0;
  } catch (_) {
    return -1;
  }
}
function mutationObserverDisconnect(value) {
  try {
    value?.disconnect?.();
    return 0;
  } catch (_) {
    return -1;
  }
}

function resizeObserverCreate(callback) {
  try {
    return typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(callback)
      : null;
  } catch (_) {
    return null;
  }
}
function resizeObserverObserve(value, target) {
  try {
    value?.observe?.(target);
    return 0;
  } catch (_) {
    return -1;
  }
}
function resizeObserverDisconnect(value) {
  try {
    value?.disconnect?.();
    return 0;
  } catch (_) {
    return -1;
  }
}

function intersectionObserverCreate(callback) {
  try {
    return typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(callback)
      : null;
  } catch (_) {
    return null;
  }
}
function intersectionObserverObserve(value, target) {
  try {
    value?.observe?.(target);
    return 0;
  } catch (_) {
    return -1;
  }
}
function intersectionObserverDisconnect(value) {
  try {
    value?.disconnect?.();
    return 0;
  } catch (_) {
    return -1;
  }
}

/* ----------------------------- Diagnostics ------------------------------- */

function browserIsSecureContext() {
  return globalThis.isSecureContext ? 1 : 0;
}

function browserHasAPI(name) {
  const parts = cstr(name).split(".");
  let value = globalThis;
  for (const part of parts) {
    if (!part) continue;
    if (value == null || !(part in value)) return 0;
    value = value[part];
  }
  return 1;
}

function browserLastError() {
  return globalThis.__BROWC_LAST_ERROR__?.message
    ? String(globalThis.__BROWC_LAST_ERROR__.message)
    : "";
}

function browserLastErrno() {
  return getErrno();
}

function browserClearError() {
  globalThis.__BROWC_LAST_ERROR__ = null;
  setErrno(0);
  return 0;
}

/* ========================================================================
 * IMPLEMENTATION REGISTRY
 * ====================================================================== */
const impl = Object.create(null);
/* assert */
impl.__assert_fail = (expr, file, line, fn) =>
  assertC(0, cstr(expr), cstr(file), Number(line), cstr(fn));
impl.assert = (expression) => assertC(expression);
/* errno */
impl.__browc_get_errno = () => getErrno();
impl.__browc_set_errno = (value) => {
  setErrno(value);
  return 0;
};
impl.__errno_location = () => {
  if (!globalThis.__BROWC_ERRNO_PTR__) {
    globalThis.__BROWC_ERRNO_PTR__ = memoryObject(4);
  }
  writeInt(globalThis.__BROWC_ERRNO_PTR__, getErrno());
  return globalThis.__BROWC_ERRNO_PTR__;
};
/* stdio */
impl.puts = (s) => {
  const text = cstr(s);
  console.log(text);
  return text.length + 1;
};
impl.putchar = (c) => {
  const ch = String.fromCharCode(Number(c) & 0xff);
  globalThis.__BROWC_STDOUT__ = String(globalThis.__BROWC_STDOUT__ || "") + ch;
  if (typeof process !== "undefined" && process.stdout?.write) {
    process.stdout.write(ch);
  } else {
    console.log(ch);
  }
  return ch.charCodeAt(0);
};
impl.printf = (format, ...args) => {
  const out = cFormat(cstr(format), args);
  console.log(out);
  return out.length;
};
impl.fprintf = (file, format, ...args) => fprintf(file, format, args);
impl.sprintf = (ptr, format, ...args) => {
  const out = cFormat(cstr(format), args);
  if (isMemory(ptr) || ptr?.__browc_ptr) {
    writeCString(ptr, out);
    return out.length;
  }
  return out;
};
impl.snprintf = (ptr, size, format, ...args) => {
  const out = cFormat(cstr(format), args);
  if (isMemory(ptr) || ptr?.__browc_ptr) writeCString(ptr, out, Number(size));
  return out.length;
};
impl.vprintf = (format, ap) =>
  impl.printf(cstr(format), ...(ap?.args?.slice(ap.index || 0) || []));
impl.vfprintf = (file, format, ap) =>
  impl.fprintf(file, format, ...(ap?.args?.slice(ap.index || 0) || []));
impl.vsprintf = (ptr, format, ap) =>
  impl.sprintf(ptr, format, ...(ap?.args?.slice(ap.index || 0) || []));
impl.vsnprintf = (ptr, size, format, ap) =>
  impl.snprintf(ptr, size, format, ...(ap?.args?.slice(ap.index || 0) || []));
impl.fputs = fputs;
impl.fputc = fputc;
impl.getchar = () => {
  if (runtime() && typeof runtime().stdinReadChar === "function") {
    return runtime().stdinReadChar();
  }
  const value = typeof prompt === "function" ? prompt("Input:") : "";
  if (!value) return BROWC.EOF;
  return value.charCodeAt(0);
};
impl.getc = fgetc;
impl.fgetc = fgetc;
impl.fgets = fgets;
impl.fopen = fopen;
impl.freopen = (filename, mode, stream) => {
  fclose(stream);
  return fopen(filename, mode);
};
impl.fclose = fclose;
impl.fflush = fflush;
impl.fseek = fseek;
impl.ftell = ftell;
impl.rewind = rewind;
impl.fread = fread;
impl.fwrite = fwrite;
impl.feof = feof;
impl.ferror = ferror;
impl.clearerr = clearerr;
impl.fileno = (file) => (isBrowCFile(file) ? 0 : -1);
impl.perror = (s) => {
  const message = `${cstr(s)}: ${
    globalThis.__BROWC_LAST_ERROR__ || `errno=${getErrno()}`
  }`;
  console.error(message);
  return 0;
};
impl.tmpfile = tmpfile;
impl.tmpnam = tmpnam;
impl.remove = (filename) => {
  const file = findFile(cstr(filename));
  if (!file) {
    setErrno(BROWC.errno.ENOENT);
    return -1;
  }
  file.remove();
  return 0;
};
impl.rename = (oldName, newName) => {
  const file = findFile(cstr(oldName));
  if (!file) {
    setErrno(BROWC.errno.ENOENT);
    return -1;
  }
  const oldTarget = findFile(cstr(newName));
  if (oldTarget) oldTarget.remove();
  file.setAttribute("filename", cstr(newName));
  return 0;
};
/* stdlib */
impl.malloc = alloc;
impl.calloc = calloc;
impl.realloc = realloc;
impl.free = free;
impl.abs = (x) => Math.abs(Number(x) | 0);
impl.labs = (x) => Math.abs(Number(x));
impl.llabs = (x) => Math.abs(Number(x));
impl.atof = (x) => Number.parseFloat(cstr(x).trim()) || 0;
impl.atoi = (x) => Number.parseInt(cstr(x).trim(), 10) || 0;
impl.atol = impl.atoi;
impl.atoll = impl.atoi;
impl.strtol = (x, _end, base) => {
  base = Number(base) || 10;
  const n = Number.parseInt(cstr(x).trim(), base);
  return Number.isNaN(n) ? 0 : n;
};
impl.strtoll = impl.strtol;
impl.strtoul = (x, e, b) => Math.max(0, impl.strtol(x, e, b));
impl.strtoull = impl.strtoul;
impl.strtof = (x) => Number.parseFloat(cstr(x).trim()) || 0;
impl.strtod = impl.strtof;
impl.strtold = impl.strtof;
impl.rand = rand;
impl.srand = srand;
impl.random_int = (min, max) =>
  Math.floor(Math.random() * (Number(max) - Number(min) + 1)) + Number(min);
impl.random_double = () => Math.random();
impl.random_range = (min, max) =>
  Math.random() * (Number(max) - Number(min)) + Number(min);
impl.getenv = (name) => {
  const key = cstr(name);
  const env = globalThis.__BROWC_ENV__ || {};
  return Object.prototype.hasOwnProperty.call(env, key) ? env[key] : null;
};
impl.system = browserSystem;
impl._Exit = (status) => {
  throw new Error(`BrowC _Exit(${Number(status) || 0})`);
};
impl.exit = (status) => {
  if (globalThis.__BROWC_ATEXIT__) {
    for (const fn of [...globalThis.__BROWC_ATEXIT__].reverse()) {
      try {
        fn();
      } catch {}
    }
  }
  throw new Error(`BrowC exit(${Number(status) || 0})`);
};
impl.abort = () => {
  throw new Error("BrowC abort()");
};
impl.atexit = (fn) => {
  if (typeof fn !== "function") return 0;
  if (!globalThis.__BROWC_ATEXIT__) globalThis.__BROWC_ATEXIT__ = [];
  globalThis.__BROWC_ATEXIT__.push(fn);
  return 0;
};
impl.aligned_alloc = (_alignment, size) => alloc(size);
impl.posix_memalign = (pp, alignment, size) => {
  const p = memoryObject(size, alignment);
  if (pp && typeof pp === "object") {
    pp.value = p;
    return 0;
  }
  return BROWC.errno.EINVAL;
};
impl.div = (a, b) => ({
  quot: Number(b) === 0 ? 0 : Math.trunc(Number(a) / Number(b)),
  rem: Number(b) === 0 ? 0 : Number(a) % Number(b),
});
impl.ldiv = impl.div;
impl.lldiv = impl.div;
impl.bsearch = (key, base, count, size, compare) => {
  const bytes = memoryRead(base, Number(count) * Number(size));
  const n = Number(size);
  let lo = 0;
  let hi = Number(count) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = bytes.slice(mid * n, (mid + 1) * n);
    const result =
      typeof compare === "function"
        ? Number(compare(key, item))
        : memcmp(key, item, n);
    if (result === 0) return pointerOffset(base, mid * n);
    if (result < 0) hi = mid - 1;
    else lo = mid + 1;
  }
  return null;
};
impl.qsort = (base, count, size, compare) => {
  const n = Number(size);
  const chunks = [];
  for (let i = 0; i < Number(count); i++) {
    chunks.push(memoryRead(pointerOffset(base, i * n), n));
  }
  chunks.sort((a, b) => {
    if (typeof compare === "function") return Number(compare(a, b));
    return memcmp(a, b, n);
  });
  for (let i = 0; i < chunks.length; i++) {
    memoryWrite(pointerOffset(base, i * n), chunks[i]);
  }
  return 0;
};
/* string */
impl.strlen = strlen;
impl.strnlen = strnlen;
impl.strcmp = strcmp;
impl.strncmp = strncmp;
impl.strcoll = strcmp;
impl.strxfrm = (dst, src, n) => {
  const value = cstr(src);
  if (dst) writeCString(dst, value, n);
  return value.length;
};
impl.strcpy = strcpy;
impl.strncpy = strncpy;
impl.strcat = strcat;
impl.strncat = strncat;
impl.strchr = strchr;
impl.strrchr = strrchr;
impl.strstr = strstr;
impl.strpbrk = strpbrk;
impl.strspn = strspn;
impl.strcspn = strcspn;
impl.strtok = strtok;
impl.strtok_r = strtok;
impl.strdup = (s) => cstr(s);
impl.strndup = (s, n) => cstr(s).slice(0, Number(n) || 0);
impl.strerror = (n) =>
  ({
    0: "No error",
    2: "No such file or directory",
    5: "I/O error",
    12: "Out of memory",
    13: "Permission denied",
    17: "File exists",
    22: "Invalid argument",
    33: "Domain error",
    34: "Result out of range",
    38: "Function not implemented",
    84: "Illegal byte sequence",
  }[Number(n)] || `BrowC error ${Number(n)}`);
impl.memcpy = memcopy;
impl.memmove = memmove;
impl.memset = memset;
impl.memcmp = memcmp;
impl.memchr = memchr;
impl.memccpy = memccpy;
impl.memmem = memmem;
impl.explicit_bzero = (ptr, n) => {
  memset(ptr, 0, n);
  return 0;
};
/* ctype */
for (const [name, fn] of Object.entries(ctype)) {
  impl[name] = fn;
}
/* math */
for (const [name, fn] of Object.entries(math)) {
  impl[name] = fn;
  if (!name.endsWith("f") && !name.endsWith("l")) {
    impl[`${name}f`] = fn;
    impl[`${name}l`] = fn;
  }
}
impl.nexttoward = math.nextafter;
/* time */
impl.time = time;
impl.clock = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();
impl.difftime = (a, b) => Number(a) - Number(b);
impl.localtime = (seconds) => localtimeCommon(seconds, false);
impl.gmtime = (seconds) => localtimeCommon(seconds, true);
impl.localtime_r = (seconds, out) =>
  Object.assign(out, localtimeCommon(seconds, false));
impl.gmtime_r = (seconds, out) =>
  Object.assign(out, localtimeCommon(seconds, true));
impl.mktime = mktime;
impl.strftime = strftime;
impl.asctime = (tm) => {
  const d = new Date(
    Number(tm?.tm_year ?? 70) + 1900,
    Number(tm?.tm_mon ?? 0),
    Number(tm?.tm_mday ?? 1),
    Number(tm?.tm_hour ?? 0),
    Number(tm?.tm_min ?? 0),
    Number(tm?.tm_sec ?? 0)
  );
  return d.toString() + "\n";
};
impl.ctime = (seconds) => impl.asctime(localtimeCommon(seconds, false));
impl.nanosleep = (req) => {
  /*
   * JavaScript cannot synchronously sleep without blocking the page.
   * Runtime/AST async support can override this implementation.
   */
  if (runtime() && typeof runtime().nanosleep === "function") {
    return runtime().nanosleep(req);
  }
  return 0;
};
impl.tzset = () => 0;
impl.gettimeofday = (tv) => {
  const ms = Date.now();
  if (tv && typeof tv === "object") {
    tv.tv_sec = Math.floor(ms / 1000);
    tv.tv_usec = (ms % 1000) * 1000;
  }
  return 0;
};
impl.clock_gettime = (_id, tp) => {
  const ns = BigInt(Date.now()) * 1000000n;
  if (tp && typeof tp === "object") {
    tp.tv_sec = Number(ns / 1000000000n);
    tp.tv_nsec = Number(ns % 1000000000n);
  }
  return 0;
};
/* locale */
impl.setlocale = setlocale;
impl.localeconv = () => ({ ...lconv });
impl.newlocale = (_mask, locale, _base) => setlocale(0, locale);
impl.duplocale = (locale) => locale;
impl.freelocale = () => 0;
impl.uselocale = (locale) => locale;
/* signal */
impl.signal = signalC;
impl.raise = raiseC;
impl._Exit = impl._Exit;
impl.quick_exit = impl.exit;
impl.at_quick_exit = impl.atexit;
/* setjmp */
impl.setjmp = setjmpC;
impl.longjmp = longjmpC;
/* stdarg */
impl.va_start = vaStart;
impl.va_arg = vaArg;
impl.va_end = vaEnd;
impl.va_copy = vaCopy;
/* fenv */
Object.assign(impl, fenv);
/* complex */
Object.assign(impl, complexMath);
/* browser DOM */
Object.assign(impl, {
  createelement,
  createelement_ns,
  getelementbyid,
  queryselector,
  queryselectorall,
  appendchild,
  prependchild,
  insertbefore,
  removechild,
  replacechild,
  parentnode,
  firstchild,
  lastchild,
  nextsibling,
  previoussibling,
  child_count: childCount,
  setattribute,
  getattribute,
  removeattribute,
  hasattribute,
  updatetextcontent: setText,
  gettextcontent: getText,
  setinnerhtml: setInnerHTML,
  getinnerhtml: getInnerHTML,
  setvalue: setValue,
  getvalue: getValue,
  addclass: addClass,
  removeclass: removeClass,
  toggleclass: toggleClass,
  hasclass: hasClass,
  setstyle: setStyle,
  getstyle: getStyle,
  setchecked: setChecked,
  getchecked: getChecked,
  setdisabled: setDisabled,
  getdisabled: getDisabled,
  focus,
  blur,
  click,
  add_event_listener: addEventListenerC,
  remove_event_listener: removeEventListenerC,
  dispatch_event: dispatchEventC,
  browser_body: browserBody,
  browser_head: browserHead,
  browser_document: () => (hasDocument() ? document : null),
  browser_window: () => (hasWindow() ? window : globalThis),
  browser_location: browserLocation,
  browser_origin: browserOrigin,
  browser_hostname: browserHostname,
  browser_host: browserHost,
  browser_protocol: browserProtocol,
  browser_pathname: browserPathname,
  browser_search: browserSearch,
  browser_hash: browserHash,
  browser_navigate: browserNavigate,
  browser_reload: browserReload,
  browser_back: browserBack,
  browser_forward: browserForward,
  browser_scroll_to: browserScrollTo,
  browser_scroll_by: browserScrollBy,
  browser_scroll_x: () => (hasWindow() ? scrollX : 0),
  browser_scroll_y: () => (hasWindow() ? scrollY : 0),
  browser_width: browserWidth,
  browser_height: browserHeight,
  browser_title_get: browserTitleGet,
  browser_title_set: browserTitleSet,
  browser_set_timeout: setTimeoutC,
  browser_clear_timeout: (id) => {
    clearTimeout(Number(id));
    return 0;
  },
  browser_set_interval: setIntervalC,
  browser_clear_interval: (id) => {
    clearInterval(Number(id));
    return 0;
  },
  requestanimationframe: (callback) =>
    hasWindow() && typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(callback)
      : setTimeoutC(callback, 16),
  cancelanimationframe: (id) => {
    if (hasWindow() && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(Number(id));
    } else {
      clearTimeout(Number(id));
    }
    return 0;
  },
});

/* extended DOM/window */
Object.assign(impl, {
  cloneelement: elementClone,
  contains: elementContains,
  isequalnode: elementEqual,
  setouterhtml: setOuterHTML,
  insertadjacenthtml: insertAdjacentHTML,
  sethidden: setHidden,
  gethidden: getHidden,
  setreadonly: setReadOnly,
  setselectedindex: setSelectedIndex,
  getselectedindex: getSelectedIndex,
  submit: submitElement,
  scrollintoview: scrollIntoViewC,
  element_left: elementLeft,
  element_top: elementTop,
  element_width: elementWidth,
  element_height: elementHeight,
  element_scroll_left: elementScrollLeft,
  element_scroll_top: elementScrollTop,
  element_set_scroll: elementSetScroll,
  browser_replace: browserReplace,
  browser_open: browserOpen,
  browser_close: browserClose,
  browser_focus: browserFocus,
  browser_print: browserPrint,
  browser_alert: browserAlert,
  browser_confirm: browserConfirm,
  browser_prompt: browserPrompt,
  browser_device_pixel_ratio: browserDevicePixelRatio,
  browser_online: browserOnline,
  browser_language: browserLanguage,
  browser_user_agent: browserUserAgent,
  requestidlecallback: requestIdleCallbackC,
  cancelidlecallback: cancelIdleCallbackC,
  localstorage_length: () =>
    hasLocalStorage() ? storageLength(localStorage) : 0,
  localstorage_key: (i) =>
    hasLocalStorage() ? storageKey(localStorage, i) : null,
  sessionstorage_length: () =>
    hasSessionStorage() ? storageLength(sessionStorage) : 0,
  sessionstorage_key: (i) =>
    hasSessionStorage() ? storageKey(sessionStorage, i) : null,
});

/* extended events */
Object.assign(impl, {
  stop_immediate_propagation: stopImmediatePropagationC,
  event_code: eventCodeC,
  event_page_x: eventPageX,
  event_page_y: eventPageY,
  event_offset_x: eventOffsetX,
  event_offset_y: eventOffsetY,
  event_buttons: eventButtons,
});

/* File System Access / File */
Object.assign(impl, {
  browser_show_open_file_picker: browserShowOpenFilePicker,
  browser_show_open_file_picker_multiple: () => browserShowOpenFilePicker(true),
  browser_show_save_file_picker: browserShowSaveFilePicker,
  browser_show_directory_picker: () => browserShowDirectoryPicker("read"),
  browser_show_directory_picker_rw: () =>
    browserShowDirectoryPicker("readwrite"),
  file_get_file: fileGetFile,
  file_create_writable: fileCreateWritable,
  file_query_permission: fileQueryPermission,
  file_request_permission: fileRequestPermission,
  file_handle_name: fileHandleName,
  file_handle_kind: fileHandleKind,
  file_handle_is_same: fileHandleIsSame,
  directory_get_file: directoryGetFile,
  directory_get_directory: directoryGetDirectory,
  directory_remove_entry: directoryRemoveEntry,
  directory_entries: directoryEntries,
  directory_resolve: directoryResolve,
  directory_handle_name: directoryHandleName,
  storage_get_directory: storageGetDirectory,
  blob_text: blobText,
  blob_array_buffer: blobArrayBuffer,
  file_text: fileText,
  file_array_buffer: fileArrayBuffer,
  file_size: fileSize,
  file_name: fileName,
  file_type: fileType,
  file_last_modified: fileLastModified,
});

/* extended canvas */
Object.assign(impl, {
  canvas_transfer_to_offscreen: canvasTransferToOffscreen,
  canvas_create_offscreen: canvasCreateOffscreen,
  canvas_bezier_curve_to: canvasBezier,
  canvas_quadratic_curve_to: canvasQuadratic,
  canvas_arc_to: canvasArcTo,
  canvas_rect: canvasRectSafe,
  canvas_fillrect: canvasFillRectSafe,
  canvas_strokeRect: canvasStrokeRectSafe,
  canvas_clearRect: canvasClearRectSafe,
  canvas_fillText: canvasFillTextSafe,
  canvas_strokeText: canvasStrokeTextSafe,
  canvas_set_line_cap: (ctx, v) => canvasSetStringProperty(ctx, "lineCap", v),
  canvas_set_line_join: (ctx, v) => canvasSetStringProperty(ctx, "lineJoin", v),
  canvas_set_miter_limit: (ctx, v) =>
    canvasSetNumericProperty(ctx, "miterLimit", v, 0, Infinity),
  canvas_set_global_alpha: canvasSetGlobalAlpha,
  canvas_set_font: (ctx, v) => canvasSetStringProperty(ctx, "font", v),
  canvas_set_text_align: (ctx, v) =>
    canvasSetStringProperty(ctx, "textAlign", v),
  canvas_set_text_baseline: (ctx, v) =>
    canvasSetStringProperty(ctx, "textBaseline", v),
  canvas_set_composite_operation: (ctx, v) =>
    canvasSetStringProperty(ctx, "globalCompositeOperation", v),
  canvas_measure_text: canvasMeasureText,
  canvas_draw_image: canvasDrawImage,
  canvas_put_image_data: canvasPutImageData,
  canvas_get_image_data: canvasGetImageData,
  canvas_to_data_url: canvasToDataURL,
  canvas_to_blob: canvasToBlob,
  canvas_width: canvasWidth,
  canvas_height: canvasHeight,
  canvas_set_size: canvasSetSize,
  image_data_create: imageDataCreate,
  image_bitmap_from: imageBitmapFrom,
  image_bitmap_decode: imageBitmapDecode,
  image_bitmap_close: imageBitmapClose,
});

/* audio/media/clipboard/geolocation/notifications/workers/crypto */
Object.assign(impl, {
  audio_load: audioLoad,
  audio_set_muted: audioSetMuted,
  audio_get_duration: audioDuration,
  audio_is_paused: audioPaused,
  audio_ended: audioEnded,
  audio_set_playback_rate: audioSetPlaybackRate,
  media_get_user_media: mediaGetUserMedia,
  media_get_display_media: mediaGetDisplayMedia,
  media_enumerate_devices: mediaEnumerateDevices,
  media_stop: mediaStop,
  clipboard_read_text: clipboardReadText,
  clipboard_write_text: clipboardWriteText,
  geolocation_current_position: geolocationCurrentPosition,
  geolocation_watch_position: geolocationWatchPosition,
  geolocation_clear_watch: geolocationClearWatch,
  notification_request_permission: notificationRequestPermission,
  notification_permission_granted: notificationPermissionGranted,
  browser_notify: browserNotify,
  worker_create: workerCreate,
  worker_post_message: workerPostMessage,
  worker_terminate: workerTerminate,
  worker_set_handlers: workerSetHandlers,
  crypto_random_uuid: cryptoRandomUUID,
  crypto_digest: cryptoDigest,
  crypto_random_bytes: cryptoRandomBytes,
  mutation_observer_create: mutationObserverCreate,
  mutation_observer_observe: mutationObserverObserve,
  mutation_observer_disconnect: mutationObserverDisconnect,
  resize_observer_create: resizeObserverCreate,
  resize_observer_observe: resizeObserverObserve,
  resize_observer_disconnect: resizeObserverDisconnect,
  intersection_observer_create: intersectionObserverCreate,
  intersection_observer_observe: intersectionObserverObserve,
  intersection_observer_disconnect: intersectionObserverDisconnect,
  browser_is_secure_context: browserIsSecureContext,
  browser_has_api: browserHasAPI,
  browser_last_error: browserLastError,
  browser_last_errno: browserLastErrno,
  browser_clear_error: browserClearError,
});

/* events */
impl.prevent_default = (e) => {
  e?.preventDefault?.();
  return 0;
};
impl.stop_propagation = (e) => {
  e?.stopPropagation?.();
  return 0;
};
impl.event_type = (e) => e?.type ?? "";
impl.event_target = (e) => e?.target ?? null;
impl.event_current_target = (e) => e?.currentTarget ?? null;
impl.event_key = (e) => e?.key ?? "";
impl.event_key_code = (e) => Number(e?.keyCode ?? e?.which ?? 0);
impl.event_client_x = (e) => Number(e?.clientX ?? 0);
impl.event_client_y = (e) => Number(e?.clientY ?? 0);
impl.event_screen_x = (e) => Number(e?.screenX ?? 0);
impl.event_screen_y = (e) => Number(e?.screenY ?? 0);
impl.event_button = (e) => Number(e?.button ?? 0);
impl.event_input_value = (e) => e?.target?.value ?? "";
impl.event_files = (e) => e?.target?.files ?? null;
/* storage */
impl.localstorage_get = (key) =>
  hasLocalStorage() ? localStorage.getItem(cstr(key)) : null;
impl.localstorage_set = (key, value) =>
  hasLocalStorage() ? storageSet(localStorage, key, value) : -1;
impl.localstorage_remove = (key) =>
  hasLocalStorage() ? storageRemove(localStorage, key) : -1;
impl.localstorage_clear = () =>
  hasLocalStorage() ? storageClear(localStorage) : -1;
impl.sessionstorage_get = (key) =>
  hasSessionStorage() ? sessionStorage.getItem(cstr(key)) : null;
impl.sessionstorage_set = (key, value) =>
  hasSessionStorage() ? storageSet(sessionStorage, key, value) : -1;
impl.sessionstorage_remove = (key) =>
  hasSessionStorage() ? storageRemove(sessionStorage, key) : -1;
impl.sessionstorage_clear = () =>
  hasSessionStorage() ? storageClear(sessionStorage) : -1;
/* JSON / URL / base64 */
impl.json_stringify = jsonStringify;
impl.json_parse = jsonParse;
impl.base64_encode = base64Encode;
impl.base64_decode = base64Decode;
impl.url_encode = (value) => encodeURIComponent(cstr(value));
impl.url_decode = (value) => decodeURIComponent(cstr(value));
/* network */
impl.web_fetch = webFetch;
impl.web_fetch_text = webFetchText;
impl.web_fetch_json = webFetchJSON;
impl.web_fetch_binary = webFetchBinary;
impl.web_request = webRequest;
impl.web_status = webStatus;
impl.web_response_text = webResponseText;
impl.web_response_json = webResponseJSON;
impl.web_set_header = webSetHeader;
impl.web_abort = webAbort;
/* websocket */
impl.websocket_connect = websocketConnect;
impl.websocket_send = websocketSend;
impl.websocket_send_binary = websocketSendBinary;
impl.websocket_close = websocketClose;
impl.websocket_is_open = websocketIsOpen;
impl.websocket_ready_state = websocketReadyState;
impl.websocket_set_handlers = websocketSetHandlers;
/* cookies / downloads */
impl.browser_set_cookie = browserSetCookie;
impl.browser_get_cookie = browserGetCookie;
impl.browser_delete_cookie = browserDeleteCookie;
impl.browser_download = browserDownload;
impl.browser_system = browserSystem;
/* console */
impl.browser_log = (...args) => {
  console.log(...args);
  return 0;
};
impl.browser_warn = (...args) => {
  console.warn(...args);
  return 0;
};
impl.browser_error = (...args) => {
  console.error(...args);
  return 0;
};
impl.console_log = impl.browser_log;
impl.console_warn = impl.browser_warn;
impl.console_error = impl.browser_error;
impl.console_info = (...args) => {
  console.info(...args);
  return 0;
};
impl.console_debug = (...args) => {
  console.debug(...args);
  return 0;
};
impl.console_clear = () => {
  console.clear();
  return 0;
};
impl.console_group = (name) => {
  console.group(cstr(name));
  return 0;
};
impl.console_group_end = () => {
  console.groupEnd();
  return 0;
};
impl.console_time = (name) => {
  console.time(cstr(name));
  return 0;
};
impl.console_time_end = (name) => {
  console.timeEnd(cstr(name));
  return 0;
};
impl.console_trace = () => {
  console.trace();
  return 0;
};
impl.console_table = (value) => {
  console.table(value);
  return 0;
};
impl.browser_alert = (message) => {
  alert(cstr(message));
  return 0;
};
impl.browser_confirm = (message) => (confirm(cstr(message)) ? 1 : 0);
impl.browser_prompt = (message, defaultValue) =>
  prompt(cstr(message), cstr(defaultValue)) ?? "";
/* canvas */
impl.canvas_create = canvasCreate;
impl.canvas_get_context = canvasGetContext;
impl.canvas_begin_path = (ctx) => {
  ctx?.beginPath?.();
  return 0;
};
impl.canvas_close_path = (ctx) => {
  ctx?.closePath?.();
  return 0;
};
impl.canvas_move_to = (ctx, x, y) => {
  ctx?.moveTo?.(Number(x), Number(y));
  return 0;
};
impl.canvas_line_to = (ctx, x, y) => {
  ctx?.lineTo?.(Number(x), Number(y));
  return 0;
};
impl.canvas_arc = (ctx, x, y, r, start, end) => {
  ctx?.arc?.(Number(x), Number(y), Number(r), Number(start), Number(end));
  return 0;
};
impl.canvas_rect = (ctx, x, y, w, h) => {
  ctx?.rect?.(Number(x), Number(y), Number(w), Number(h));
  return 0;
};
impl.canvas_fill = (ctx) => {
  ctx?.fill?.();
  return 0;
};
impl.canvas_stroke = (ctx) => {
  ctx?.stroke?.();
  return 0;
};
impl.canvas_clear = canvasClear;
impl.canvas_fillrect = (ctx, x, y, w, h) => {
  ctx?.fillRect?.(Number(x), Number(y), Number(w), Number(h));
  return 0;
};
impl.canvas_strokeRect = (ctx, x, y, w, h) => {
  ctx?.strokeRect?.(Number(x), Number(y), Number(w), Number(h));
  return 0;
};
impl.canvas_fillText = (ctx, text, x, y) => {
  ctx?.fillText?.(cstr(text), Number(x), Number(y));
  return 0;
};
impl.canvas_strokeText = (ctx, text, x, y) => {
  ctx?.strokeText?.(cstr(text), Number(x), Number(y));
  return 0;
};
impl.canvas_set_fill_style = canvasSetFillStyle;
impl.canvas_set_stroke_style = canvasSetStrokeStyle;
impl.canvas_set_line_width = canvasSetLineWidth;
impl.canvas_translate = (ctx, x, y) => {
  ctx?.translate?.(Number(x), Number(y));
  return 0;
};
impl.canvas_rotate = (ctx, angle) => {
  ctx?.rotate?.(Number(angle));
  return 0;
};
impl.canvas_scale = (ctx, x, y) => {
  ctx?.scale?.(Number(x), Number(y));
  return 0;
};
impl.canvas_save = (ctx) => {
  ctx?.save?.();
  return 0;
};
impl.canvas_restore = (ctx) => {
  ctx?.restore?.();
  return 0;
};
/* audio */
impl.audio_create = audioCreate;
impl.audio_play = (a) => {
  a?.play?.();
  return 0;
};
impl.audio_pause = (a) => {
  a?.pause?.();
  return 0;
};
impl.audio_set_volume = (a, v) => {
  if (a) a.volume = Math.max(0, Math.min(1, Number(v)));
  return 0;
};
impl.audio_set_loop = (a, v) => {
  if (a) a.loop = !!Number(v);
  return 0;
};
impl.audio_set_current_time = (a, t) => {
  if (a) a.currentTime = Number(t);
  return 0;
};
impl.audio_get_current_time = (a) => Number(a?.currentTime || 0);
/* direct memory helpers */
impl.memory_size = memorySize;
impl.memory_read8 = (ptr, offset) =>
  memoryView(pointerOffset(ptr, Number(offset) || 0))[0] ?? 0;
impl.memory_write8 = (ptr, offset, value) => {
  memoryView(pointerOffset(ptr, Number(offset) || 0))[0] = Number(value) & 0xff;
  return 0;
};
impl.memory_read16 = (ptr, offset) => {
  const d = checkedMemory(pointerOffset(ptr, Number(offset) || 0));
  return new DataView(
    d.memory.buffer,
    d.memory.byteOffset,
    d.memory.byteLength
  ).getUint16(d.offset, true);
};
impl.memory_write16 = (ptr, offset, value) => {
  const d = checkedMemory(pointerOffset(ptr, Number(offset) || 0));
  new DataView(
    d.memory.buffer,
    d.memory.byteOffset,
    d.memory.byteLength
  ).setUint16(d.offset, Number(value) & 0xffff, true);
  return 0;
};
impl.memory_read32 = (ptr, offset) => {
  const d = checkedMemory(pointerOffset(ptr, Number(offset) || 0));
  return new DataView(
    d.memory.buffer,
    d.memory.byteOffset,
    d.memory.byteLength
  ).getUint32(d.offset, true);
};
impl.memory_write32 = (ptr, offset, value) => {
  const d = checkedMemory(pointerOffset(ptr, Number(offset) || 0));
  new DataView(
    d.memory.buffer,
    d.memory.byteOffset,
    d.memory.byteLength
  ).setUint32(d.offset, Number(value) >>> 0, true);
  return 0;
};
/* ========================================================================
 * SYSTEM HEADER SOURCES
 * ====================================================================== */
const HEADERS = {
  "assert.h": `
#ifndef _BROWC_ASSERT_H
#define _BROWC_ASSERT_H
void __assert_fail(const char *expression,
                   const char *file,
                   int line,
                   const char *function);
void assert(int expression);
#endif
`,
  "complex.h": `
#ifndef _BROWC_COMPLEX_H
#define _BROWC_COMPLEX_H
#define complex _Complex
#define _Complex_I __BROWC_COMPLEX_I__
#define I _Complex_I
double creal(double complex z);
double cimag(double complex z);
double cabs(double complex z);
double carg(double complex z);
double complex conj(double complex z);
double complex cproj(double complex z);
double complex cexp(double complex z);
double complex clog(double complex z);
double complex csqrt(double complex z);
double complex cpow(double complex x, double complex y);
double complex csin(double complex z);
double complex ccos(double complex z);
double complex ctan(double complex z);
double complex casin(double complex z);
double complex cacos(double complex z);
double complex catan(double complex z);
double complex csinh(double complex z);
double complex ccosh(double complex z);
double complex ctanh(double complex z);
#endif
`,
  "ctype.h": `
#ifndef _BROWC_CTYPE_H
#define _BROWC_CTYPE_H
int isalnum(int c);
int isalpha(int c);
int isblank(int c);
int iscntrl(int c);
int isdigit(int c);
int isgraph(int c);
int islower(int c);
int isprint(int c);
int ispunct(int c);
int isspace(int c);
int isupper(int c);
int isxdigit(int c);
int tolower(int c);
int toupper(int c);
#endif
`,
  "errno.h": `
#ifndef _BROWC_ERRNO_H
#define _BROWC_ERRNO_H
extern int errno;
#define EPERM 1
#define ENOENT 2
#define EINTR 4
#define EIO 5
#define EBADF 9
#define EAGAIN 11
#define ENOMEM 12
#define EACCES 13
#define EEXIST 17
#define ENOTDIR 20
#define EISDIR 21
#define EINVAL 22
#define EMFILE 24
#define ENOSPC 28
#define EPIPE 32
#define EDOM 33
#define ERANGE 34
#define ENOSYS 38
#define EILSEQ 84
int *__errno_location(void);
int __browc_get_errno(void);
int __browc_set_errno(int value);
#endif
`,
  "fenv.h": `
#ifndef _BROWC_FENV_H
#define _BROWC_FENV_H
typedef int fenv_t;
typedef int fexcept_t;
#define FE_DOWNWARD 0x400
#define FE_TONEAREST 0
#define FE_TOWARDZERO 0xC00
#define FE_UPWARD 0x800
#define FE_DIVBYZERO 4
#define FE_INEXACT 32
#define FE_INVALID 1
#define FE_OVERFLOW 8
#define FE_UNDERFLOW 16
int feclearexcept(int exceptions);
int fegetexceptflag(fexcept_t *flagp, int exceptions);
int feraiseexcept(int exceptions);
int fesetexceptflag(const fexcept_t *flagp, int exceptions);
int fetestexcept(int exceptions);
int fegetround(void);
int fesetround(int round);
int fegetenv(fenv_t *envp);
int feholdexcept(fenv_t *envp);
int fesetenv(const fenv_t *envp);
int feupdateenv(const fenv_t *envp);
#endif
`,
  "float.h": `
#ifndef _BROWC_FLOAT_H
#define _BROWC_FLOAT_H
#define FLT_RADIX 2
#define FLT_MANT_DIG 53
#define DBL_MANT_DIG 53
#define LDBL_MANT_DIG 53
#define FLT_DIG 15
#define DBL_DIG 15
#define LDBL_DIG 15
#define FLT_MIN 2.2250738585072014e-308
#define DBL_MIN 2.2250738585072014e-308
#define LDBL_MIN 2.2250738585072014e-308
#define FLT_MAX 1.7976931348623157e308
#define DBL_MAX 1.7976931348623157e308
#define LDBL_MAX 1.7976931348623157e308
#define FLT_EPSILON 2.220446049250313e-16
#define DBL_EPSILON 2.220446049250313e-16
#define LDBL_EPSILON 2.220446049250313e-16
#define FLT_ROUNDS 1
#endif
`,
  "inttypes.h": `
#ifndef _BROWC_INTTYPES_H
#define _BROWC_INTTYPES_H
typedef long long intmax_t;
typedef unsigned long long uintmax_t;
#define PRId8 "d"
#define PRIi8 "i"
#define PRIo8 "o"
#define PRIu8 "u"
#define PRIx8 "x"
#define PRIX8 "X"
#define PRId16 "d"
#define PRIi16 "i"
#define PRIo16 "o"
#define PRIu16 "u"
#define PRIx16 "x"
#define PRIX16 "X"
#define PRId32 "d"
#define PRIi32 "i"
#define PRIo32 "o"
#define PRIu32 "u"
#define PRIx32 "x"
#define PRIX32 "X"
#define PRId64 "d"
#define PRIi64 "i"
#define PRIo64 "o"
#define PRIu64 "u"
#define PRIx64 "x"
#define PRIX64 "X"
intmax_t imaxabs(intmax_t value);
#endif
`,
  "iso646.h": `
#ifndef _BROWC_ISO646_H
#define _BROWC_ISO646_H
#define and &&
#define and_eq &=
#define bitand &
#define bitor |
#define compl ~
#define not !
#define not_eq !=
#define or ||
#define or_eq |=
#define xor ^
#define xor_eq ^=
#endif
`,
  "limits.h": `
#ifndef _BROWC_LIMITS_H
#define _BROWC_LIMITS_H
#define CHAR_BIT 8
#define SCHAR_MIN -128
#define SCHAR_MAX 127
#define UCHAR_MAX 255
#define CHAR_MIN -128
#define CHAR_MAX 127
#define SHRT_MIN -32768
#define SHRT_MAX 32767
#define USHRT_MAX 65535
#define INT_MIN -2147483648
#define INT_MAX 2147483647
#define UINT_MAX 4294967295
#define LONG_MIN -9223372036854775808
#define LONG_MAX 9223372036854775807
#define ULONG_MAX 18446744073709551615
#define LLONG_MIN -9223372036854775808
#define LLONG_MAX 9223372036854775807
#define ULLONG_MAX 18446744073709551615
#define MB_LEN_MAX 4
#endif
`,
  "locale.h": `
#ifndef _BROWC_LOCALE_H
#define _BROWC_LOCALE_H
typedef void *locale_t;
#define LC_ALL 0
#define LC_COLLATE 1
#define LC_CTYPE 2
#define LC_MONETARY 3
#define LC_NUMERIC 4
#define LC_TIME 5
struct lconv {
    char *decimal_point;
    char *thousands_sep;
    char *grouping;
    char *int_curr_symbol;
    char *currency_symbol;
    char *mon_decimal_point;
    char *mon_thousands_sep;
    char *mon_grouping;
    char *positive_sign;
    char *negative_sign;
    char int_frac_digits;
    char frac_digits;
    char p_cs_precedes;
    char p_sep_by_space;
    char n_cs_precedes;
    char n_sep_by_space;
    char p_sign_posn;
    char n_sign_posn;
};
char *setlocale(int category, const char *locale);
struct lconv *localeconv(void);
locale_t newlocale(int category_mask, const char *locale, locale_t base);
locale_t duplocale(locale_t locale);
void freelocale(locale_t locale);
locale_t uselocale(locale_t locale);
#endif
`,
  "math.h": `
#ifndef _BROWC_MATH_H
#define _BROWC_MATH_H
#define M_E 2.718281828459045
#define M_LOG2E 1.4426950408889634
#define M_LOG10E 0.4342944819032518
#define M_LN2 0.6931471805599453
#define M_LN10 2.302585092994046
#define M_PI 3.141592653589793
#define M_PI_2 1.5707963267948966
#define M_PI_4 0.7853981633974483
#define M_1_PI 0.3183098861837907
#define M_2_PI 0.6366197723675814
#define M_2_SQRTPI 1.1283791670955126
#define M_SQRT2 1.4142135623730951
#define M_SQRT1_2 0.7071067811865476
double sin(double x); double cos(double x); double tan(double x);
double asin(double x); double acos(double x); double atan(double x);
double atan2(double y, double x);
double sinh(double x); double cosh(double x); double tanh(double x);
double asinh(double x); double acosh(double x); double atanh(double x);
double exp(double x); double exp2(double x); double expm1(double x);
double log(double x); double log10(double x); double log2(double x);
double log1p(double x);
double pow(double x, double y); double sqrt(double x); double cbrt(double x);
double hypot(double x, double y);
double ceil(double x); double floor(double x); double trunc(double x);
double round(double x); double nearbyint(double x); double rint(double x);
double fmod(double x, double y); double remainder(double x, double y);
double fabs(double x); double fdim(double x, double y);
double fmax(double x, double y); double fmin(double x, double y);
double copysign(double x, double y);
double frexp(double x, int *exp);
double ldexp(double x, int exp);
double scalbn(double x, int n);
double scalbln(double x, long n);
int ilogb(double x); double logb(double x);
double nextafter(double x, double y);
double nexttoward(double x, long double y);
double erf(double x); double erfc(double x);
double tgamma(double x); double lgamma(double x);
double modf(double x, double *iptr);
double nan(const char *tagp);
double fma(double x, double y, double z);
#endif
`,
  "setjmp.h": `
#ifndef _BROWC_SETJMP_H
#define _BROWC_SETJMP_H
typedef struct {
    int __browc_valid;
    int __browc_value;
} jmp_buf[1];
int setjmp(jmp_buf env);
void longjmp(jmp_buf env, int value);
#endif
`,
  "signal.h": `
#ifndef _BROWC_SIGNAL_H
#define _BROWC_SIGNAL_H
#define SIGABRT 6
#define SIGFPE 8
#define SIGILL 4
#define SIGINT 2
#define SIGSEGV 11
#define SIGTERM 15
#define SIG_DFL 0
#define SIG_IGN 1
#define SIG_ERR ((void *)-1)
typedef void (*sighandler_t)(int);
sighandler_t signal(int signal_number, sighandler_t handler);
int raise(int signal_number);
void abort(void);
void _Exit(int status);
void quick_exit(int status);
int at_quick_exit(void (*function)(void));
#endif
`,
  "stdarg.h": `
#ifndef _BROWC_STDARG_H
#define _BROWC_STDARG_H
typedef struct {
    void *__browc_args;
    unsigned long __browc_index;
} va_list;
void va_start(va_list ap, void *last);
void va_end(va_list ap);
void *va_arg(va_list ap, void *type);
void va_copy(va_list dest, va_list src);
#endif
`,
  "stdbool.h": `
#ifndef _BROWC_STDBOOL_H
#define _BROWC_STDBOOL_H
#define bool _Bool
#define true 1
#define false 0
#define __bool_true_false_are_defined 1
#endif
`,
  "stddef.h": `
#ifndef _BROWC_STDDEF_H
#define _BROWC_STDDEF_H
typedef unsigned long size_t;
typedef long ptrdiff_t;
typedef unsigned long max_align_t;
typedef void *nullptr_t;
#define NULL ((void *)0)
#endif
`,
  "stdint.h": `
#ifndef _BROWC_STDINT_H
#define _BROWC_STDINT_H
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef signed char int_least8_t;
typedef unsigned char uint_least8_t;
typedef short int_least16_t;
typedef unsigned short uint_least16_t;
typedef int int_least32_t;
typedef unsigned int uint_least32_t;
typedef long long int_least64_t;
typedef unsigned long long uint_least64_t;
typedef signed char int_fast8_t;
typedef unsigned char uint_fast8_t;
typedef short int_fast16_t;
typedef unsigned short uint_fast16_t;
typedef int int_fast32_t;
typedef unsigned int uint_fast32_t;
typedef long long int_fast64_t;
typedef unsigned long long uint_fast64_t;
typedef long long intmax_t;
typedef unsigned long long uintmax_t;
typedef long intptr_t;
typedef unsigned long uintptr_t;
#define INT8_MIN -128
#define INT8_MAX 127
#define UINT8_MAX 255
#define INT16_MIN -32768
#define INT16_MAX 32767
#define UINT16_MAX 65535
#define INT32_MIN -2147483648
#define INT32_MAX 2147483647
#define UINT32_MAX 4294967295
#define INT64_MIN -9223372036854775808
#define INT64_MAX 9223372036854775807
#define UINT64_MAX 18446744073709551615
#define INTPTR_MIN -9223372036854775808
#define INTPTR_MAX 9223372036854775807
#define UINTPTR_MAX 18446744073709551615
#define INTMAX_MIN -9223372036854775808
#define INTMAX_MAX 9223372036854775807
#define UINTMAX_MAX 18446744073709551615
#define SIZE_MAX 18446744073709551615
#define PTRDIFF_MIN -9223372036854775808
#define PTRDIFF_MAX 9223372036854775807
#endif
`,
  "stdio.h": `
#ifndef _BROWC_STDIO_H
#define _BROWC_STDIO_H
#include <stdarg.h>
typedef unsigned long size_t;
typedef struct browc_file FILE;
extern FILE *stdin;
extern FILE *stdout;
extern FILE *stderr;
#define EOF (-1)
#define FOPEN_MAX 1024
#define FILENAME_MAX 4096
#define BUFSIZ 8192
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2
#define TMP_MAX 10000
int printf(const char *format, ...);
int fprintf(FILE *stream, const char *format, ...);
int sprintf(char *buffer, const char *format, ...);
int snprintf(char *buffer, size_t size, const char *format, ...);
int vprintf(const char *format, va_list ap);
int vfprintf(FILE *stream, const char *format, va_list ap);
int vsprintf(char *buffer, const char *format, va_list ap);
int vsnprintf(char *buffer, size_t size, const char *format, va_list ap);
int puts(const char *s);
int putchar(int c);
int fputs(const char *s, FILE *stream);
int fputc(int c, FILE *stream);
int getchar(void);
int getc(FILE *stream);
int fgetc(FILE *stream);
char *gets(char *s);
char *fgets(char *s, int n, FILE *stream);
FILE *fopen(const char *filename, const char *mode);
FILE *freopen(const char *filename, const char *mode, FILE *stream);
int fclose(FILE *stream);
int fflush(FILE *stream);
int fseek(FILE *stream, long offset, int origin);
long ftell(FILE *stream);
void rewind(FILE *stream);
size_t fread(void *ptr, size_t size, size_t count, FILE *stream);
size_t fwrite(const void *ptr, size_t size, size_t count, FILE *stream);
int feof(FILE *stream);
int ferror(FILE *stream);
void clearerr(FILE *stream);
int fileno(FILE *stream);
void perror(const char *s);
FILE *tmpfile(void);
char *tmpnam(char *buffer);
int remove(const char *filename);
int rename(const char *old_name, const char *new_name);
#endif
`,
  "stdlib.h": `
#ifndef _BROWC_STDLIB_H
#define _BROWC_STDLIB_H
typedef unsigned long size_t;
#define EXIT_SUCCESS 0
#define EXIT_FAILURE 1
#define RAND_MAX 2147483647
#define MB_CUR_MAX 4
void *malloc(size_t size);
void *calloc(size_t count, size_t size);
void *realloc(void *ptr, size_t size);
void free(void *ptr);
void abort(void);
void exit(int status);
void _Exit(int status);
int atexit(void (*function)(void));
int abs(int value);
long labs(long value);
long long llabs(long long value);
typedef struct {
    int quot;
    int rem;
} div_t;
typedef struct {
    long quot;
    long rem;
} ldiv_t;
typedef struct {
    long long quot;
    long long rem;
} lldiv_t;
div_t div(int numerator, int denominator);
ldiv_t ldiv(long numerator, long denominator);
lldiv_t lldiv(long long numerator, long long denominator);
double atof(const char *text);
int atoi(const char *text);
long atol(const char *text);
long long atoll(const char *text);
long strtol(const char *text, char **endptr, int base);
unsigned long strtoul(const char *text, char **endptr, int base);
long long strtoll(const char *text, char **endptr, int base);
unsigned long long strtoull(const char *text, char **endptr, int base);
float strtof(const char *text, char **endptr);
double strtod(const char *text, char **endptr);
long double strtold(const char *text, char **endptr);
void *bsearch(
    const void *key,
    const void *base,
    size_t count,
    size_t size,
    int (*compare)(const void *, const void *)
);
void qsort(
    void *base,
    size_t count,
    size_t size,
    int (*compare)(const void *, const void *)
);
int rand(void);
void srand(unsigned int seed);
char *getenv(const char *name);
int system(const char *command);
int mblen(const char *text, size_t length);
int mbtowc(void *wide_char, const char *text, size_t length);
int wctomb(char *text, void *wide_char);
size_t mbstowcs(void *wide_string, const char *text, size_t count);
size_t wcstombs(char *text, const void *wide_string, size_t count);
void *aligned_alloc(size_t alignment, size_t size);
int posix_memalign(void **pointer, size_t alignment, size_t size);
#endif
`,
  "string.h": `
#ifndef _BROWC_STRING_H
#define _BROWC_STRING_H
typedef unsigned long size_t;
void *memcpy(void *destination, const void *source, size_t size);
void *memmove(void *destination, const void *source, size_t size);
void *memset(void *destination, int value, size_t size);
int memcmp(const void *a, const void *b, size_t size);
void *memchr(const void *memory, int value, size_t size);
size_t strlen(const char *s);
size_t strnlen(const char *s, size_t max_length);
char *strcpy(char *destination, const char *source);
char *strncpy(char *destination, const char *source, size_t count);
char *strcat(char *destination, const char *source);
char *strncat(char *destination, const char *source, size_t count);
int strcmp(const char *a, const char *b);
int strncmp(const char *a, const char *b, size_t count);
int strcoll(const char *a, const char *b);
size_t strxfrm(char *destination, const char *source, size_t count);
char *strchr(const char *s, int c);
char *strrchr(const char *s, int c);
char *strstr(const char *haystack, const char *needle);
char *strpbrk(const char *s, const char *accept);
size_t strspn(const char *s, const char *accept);
size_t strcspn(const char *s, const char *reject);
char *strtok(char *s, const char *delimiters);
char *strerror(int error_number);
char *strdup(const char *s);
char *strndup(const char *s, size_t count);
#endif
`,
  "tgmath.h": `
#ifndef _BROWC_TGMATH_H
#define _BROWC_TGMATH_H
#include <math.h>
#endif
`,
  "time.h": `
#ifndef _BROWC_TIME_H
#define _BROWC_TIME_H
typedef long time_t;
typedef long clock_t;
#define CLOCKS_PER_SEC 1000
struct tm {
    int tm_sec;
    int tm_min;
    int tm_hour;
    int tm_mday;
    int tm_mon;
    int tm_year;
    int tm_wday;
    int tm_yday;
    int tm_isdst;
};
time_t time(time_t *timer);
clock_t clock(void);
double difftime(time_t end_time, time_t start_time);
time_t mktime(struct tm *time);
struct tm *localtime(const time_t *timer);
struct tm *gmtime(const time_t *timer);
struct tm *localtime_r(
    const time_t *timer,
    struct tm *result
);
struct tm *gmtime_r(
    const time_t *timer,
    struct tm *result
);
char *asctime(const struct tm *time);
char *ctime(const time_t *timer);
size_t strftime(
    char *buffer,
    size_t max_size,
    const char *format,
    const struct tm *time
);
int nanosleep(const void *request, void *remaining);
void tzset(void);
int gettimeofday(void *tv, void *tz);
int clock_gettime(int clock_id, void *timespec);
#endif
`,
  "wchar.h": `
#ifndef _BROWC_WCHAR_H
#define _BROWC_WCHAR_H
typedef unsigned long wchar_t;
typedef unsigned long wint_t;
typedef unsigned long size_t;
size_t wcslen(const wchar_t *s);
size_t wcsnlen(const wchar_t *s, size_t count);
int wcscmp(const wchar_t *a, const wchar_t *b);
int wcsncmp(const wchar_t *a, const wchar_t *b, size_t count);
wchar_t *wcscpy(wchar_t *destination, const wchar_t *source);
wchar_t *wcsncpy(wchar_t *destination, const wchar_t *source, size_t count);
wchar_t *wcscat(wchar_t *destination, const wchar_t *source);
wchar_t *wcsncat(wchar_t *destination, const wchar_t *source, size_t count);
wchar_t *wcschr(const wchar_t *s, wchar_t c);
wchar_t *wcsrchr(const wchar_t *s, wchar_t c);
size_t wcsspn(const wchar_t *s, const wchar_t *accept);
size_t wcscspn(const wchar_t *s, const wchar_t *reject);
wchar_t *wcsstr(const wchar_t *haystack, const wchar_t *needle);
size_t mbrlen(const char *s, size_t n, void *state);
int btowc(int c);
int wctob(wint_t wc);
size_t mbrtowc(
    wchar_t *wc,
    const char *s,
    size_t n,
    void *state
);
size_t wcrtomb(
    char *s,
    wchar_t wc,
    void *state
);
size_t mbsrtowcs(
    wchar_t *destination,
    const char **source,
    size_t length,
    void *state
);
size_t wcsrtombs(
    char *destination,
    const wchar_t **source,
    size_t length,
    void *state
);
int fwide(void *stream, int mode);
int wcwidth(wchar_t wc);
int wcswidth(const wchar_t *s, size_t count);
#endif
`,
  "wctype.h": `
#ifndef _BROWC_WCTYPE_H
#define _BROWC_WCTYPE_H
typedef unsigned long wint_t;
typedef unsigned long wctype_t;
typedef unsigned long wctrans_t;
int iswalnum(wint_t wc);
int iswalpha(wint_t wc);
int iswblank(wint_t wc);
int iswcntrl(wint_t wc);
int iswdigit(wint_t wc);
int iswgraph(wint_t wc);
int iswlower(wint_t wc);
int iswprint(wint_t wc);
int iswpunct(wint_t wc);
int iswspace(wint_t wc);
int iswupper(wint_t wc);
int iswxdigit(wint_t wc);
wint_t towlower(wint_t wc);
wint_t towupper(wint_t wc);
wctype_t wctype(const char *name);
int iswctype(wint_t wc, wctype_t description);
wctrans_t wctrans(const char *name);
wint_t towctrans(wint_t wc, wctrans_t trans);
#endif
`,
  "browser.h": `
#ifndef _BROWC_BROWSER_H
#define _BROWC_BROWSER_H

/* BrowC browser-native opaque handles. */
typedef void *dom;
typedef void *event;
typedef void *canvas;
typedef void *audio;
typedef void *timer;
typedef void *storage;
typedef void *promise;
typedef void *websocket;
typedef void *file_handle;
typedef void *directory_handle;
typedef void *image;
typedef void *worker;
typedef void *observer;
typedef void *media;
typedef void *request;
typedef void *response;

#define BROWSER_OK 0
#define BROWSER_ERROR (-1)
#define BROWSER_TRUE 1
#define BROWSER_FALSE 0

/* -------------------------------------------------------------------------
 * DOM / Document
 * ------------------------------------------------------------------------- */
dom createelement(const char *tag);
dom createelement_ns(const char *namespace_uri, const char *tag);
dom getelementbyid(const char *id);
dom queryselector(const char *selector);
dom queryselectorall(const char *selector);
dom browser_document(void);
dom browser_window(void);
dom browser_body(void);
dom browser_head(void);

void appendchild(dom parent, dom child);
void prependchild(dom parent, dom child);
void insertbefore(dom parent, dom child, dom reference);
void removechild(dom parent, dom child);
void replacechild(dom parent, dom child, dom old_child);
dom cloneelement(dom element, int deep);
dom parentnode(dom element);
dom firstchild(dom element);
dom lastchild(dom element);
dom nextsibling(dom element);
dom previoussibling(dom element);
int child_count(dom element);
int contains(dom parent, dom child);
int isequalnode(dom a, dom b);

void setattribute(dom element, const char *name, const char *value);
const char *getattribute(dom element, const char *name);
void removeattribute(dom element, const char *name);
int hasattribute(dom element, const char *name);

void updatetextcontent(dom element, const char *text);
const char *gettextcontent(dom element);
void setinnerhtml(dom element, const char *html);
const char *getinnerhtml(dom element);
void setouterhtml(dom element, const char *html);
void insertadjacenthtml(dom element, const char *position, const char *html);

void setvalue(dom element, const char *value);
const char *getvalue(dom element);
void setchecked(dom element, int checked);
int getchecked(dom element);
void setdisabled(dom element, int disabled);
int getdisabled(dom element);
void sethidden(dom element, int hidden);
int gethidden(dom element);
void setreadonly(dom element, int readonly);
void setselectedindex(dom element, int index);
int getselectedindex(dom element);

void addclass(dom element, const char *name);
void removeclass(dom element, const char *name);
int toggleclass(dom element, const char *name);
int hasclass(dom element, const char *name);
void setstyle(dom element, const char *property, const char *value);
const char *getstyle(dom element, const char *property);

void focus(dom element);
void blur(dom element);
void click(dom element);
void submit(dom element);
void scrollintoview(dom element);
int dispatch_event(dom element, const char *event_name);
void add_event_listener(dom element, const char *event_name, void *callback);
void remove_event_listener(dom element, const char *event_name, void *callback);

/* DOM geometry / attributes useful for UI applications. */
double element_left(dom element);
double element_top(dom element);
double element_width(dom element);
double element_height(dom element);
double element_scroll_left(dom element);
double element_scroll_top(dom element);
void element_set_scroll(dom element, double x, double y);

/* -------------------------------------------------------------------------
 * Events
 * ------------------------------------------------------------------------- */
void prevent_default(event e);
void stop_propagation(event e);
void stop_immediate_propagation(event e);
const char *event_type(event e);
dom event_target(event e);
dom event_current_target(event e);
const char *event_key(event e);
const char *event_code(event e);
int event_key_code(event e);
double event_client_x(event e);
double event_client_y(event e);
double event_screen_x(event e);
double event_screen_y(event e);
double event_page_x(event e);
double event_page_y(event e);
double event_offset_x(event e);
double event_offset_y(event e);
int event_button(event e);
int event_buttons(event e);
const char *event_input_value(event e);
void *event_files(event e);

/* -------------------------------------------------------------------------
 * Window / navigation / viewport
 * ------------------------------------------------------------------------- */
const char *browser_location(void);
const char *browser_origin(void);
const char *browser_hostname(void);
const char *browser_host(void);
const char *browser_protocol(void);
const char *browser_pathname(void);
const char *browser_search(void);
const char *browser_hash(void);
void browser_navigate(const char *url);
void browser_replace(const char *url);
void browser_reload(void);
void browser_back(void);
void browser_forward(void);
void browser_scroll_to(double x, double y);
void browser_scroll_by(double x, double y);
double browser_scroll_x(void);
double browser_scroll_y(void);
double browser_width(void);
double browser_height(void);
double browser_device_pixel_ratio(void);
int browser_online(void);
const char *browser_language(void);
const char *browser_user_agent(void);
const char *browser_title_get(void);
void browser_title_set(const char *title);

int browser_alert(const char *message);
int browser_confirm(const char *message);
const char *browser_prompt(const char *message, const char *default_value);

void browser_open(const char *url, const char *target);
void browser_close(void);
void browser_focus(void);
void browser_print(void);

/* -------------------------------------------------------------------------
 * Timers / animation / idle callbacks
 * ------------------------------------------------------------------------- */
timer browser_set_timeout(void *callback, int milliseconds);
void browser_clear_timeout(timer id);
timer browser_set_interval(void *callback, int milliseconds);
void browser_clear_interval(timer id);
timer requestanimationframe(void *callback);
void cancelanimationframe(timer id);
timer requestidlecallback(void *callback);
void cancelidlecallback(timer id);

/* -------------------------------------------------------------------------
 * Local/session storage
 * ------------------------------------------------------------------------- */
const char *localstorage_get(const char *key);
void localstorage_set(const char *key, const char *value);
void localstorage_remove(const char *key);
void localstorage_clear(void);
int localstorage_length(void);
const char *localstorage_key(int index);

const char *sessionstorage_get(const char *key);
void sessionstorage_set(const char *key, const char *value);
void sessionstorage_remove(const char *key);
void sessionstorage_clear(void);
int sessionstorage_length(void);
const char *sessionstorage_key(int index);

/* -------------------------------------------------------------------------
 * JSON / URL / Base64
 * ------------------------------------------------------------------------- */
const char *json_stringify(void *value);
void *json_parse(const char *text);
const char *base64_encode(const char *text);
const char *base64_decode(const char *text);
const char *url_encode(const char *text);
const char *url_decode(const char *text);

/* -------------------------------------------------------------------------
 * Fetch / HTTP
 * ------------------------------------------------------------------------- */
promise web_fetch(const char *url);
promise web_fetch_text(const char *url);
promise web_fetch_json(const char *url);
promise web_fetch_binary(const char *url);
promise web_request(const char *url, const char *method, const char *body);
int web_status(response response_value);
const char *web_response_text(response response_value);
promise web_response_json(response response_value);
void web_set_header(request request_value, const char *name, const char *value);
void web_abort(request request_value);

/* -------------------------------------------------------------------------
 * WebSocket
 * ------------------------------------------------------------------------- */
websocket websocket_connect(const char *url);
void websocket_send(websocket socket, const char *message);
void websocket_send_binary(websocket socket, void *data, int length);
void websocket_close(websocket socket);
int websocket_is_open(websocket socket);
int websocket_ready_state(websocket socket);
void websocket_set_handlers(
    websocket socket,
    void *onopen,
    void *onmessage,
    void *onerror,
    void *onclose
);

/* -------------------------------------------------------------------------
 * Cookies / downloads
 * ------------------------------------------------------------------------- */
void browser_set_cookie(const char *name, const char *value);
void browser_set_cookie_ex(
    const char *name,
    const char *value,
    int max_age,
    const char *path
);
const char *browser_get_cookie(const char *name);
void browser_delete_cookie(const char *name);
void browser_download(const char *filename, const char *content, const char *mime);

/* -------------------------------------------------------------------------
 * File System Access API
 *
 * These functions return promises because the native browser API is
 * asynchronous and permission-gated.
 * ------------------------------------------------------------------------- */
promise browser_show_open_file_picker(void);
promise browser_show_open_file_picker_multiple(int multiple);
promise browser_show_save_file_picker(void);
promise browser_show_directory_picker(void);
promise browser_show_directory_picker_rw(void);

promise file_get_file(file_handle handle);
promise file_create_writable(file_handle handle);
promise file_query_permission(file_handle handle, int write);
promise file_request_permission(file_handle handle, int write);
const char *file_handle_name(file_handle handle);
const char *file_handle_kind(file_handle handle);
promise file_handle_is_same(file_handle a, file_handle b);

promise directory_get_file(directory_handle directory, const char *name, int create);
promise directory_get_directory(directory_handle directory, const char *name, int create);
promise directory_remove_entry(directory_handle directory, const char *name, int recursive);
promise directory_entries(directory_handle directory);
promise directory_resolve(directory_handle directory, file_handle handle);
const char *directory_handle_name(directory_handle directory);
promise storage_get_directory(void);

/* File / Blob helpers. */
promise blob_text(void *blob);
promise blob_array_buffer(void *blob);
promise file_text(file_handle handle);
promise file_array_buffer(file_handle handle);
int file_size(void *file);
const char *file_name(void *file);
const char *file_type(void *file);
double file_last_modified(void *file);

/* -------------------------------------------------------------------------
 * Canvas 2D / WebGL / OffscreenCanvas
 * ------------------------------------------------------------------------- */
canvas canvas_create(dom element);
canvas canvas_get_context(canvas target, const char *context_type);
canvas canvas_transfer_to_offscreen(dom element);
canvas canvas_create_offscreen(int width, int height);
void canvas_clear(canvas target);
void canvas_begin_path(canvas target);
void canvas_close_path(canvas target);
void canvas_move_to(canvas target, double x, double y);
void canvas_line_to(canvas target, double x, double y);
void canvas_bezier_curve_to(canvas target, double cp1x, double cp1y,
                           double cp2x, double cp2y, double x, double y);
void canvas_quadratic_curve_to(canvas target, double cpx, double cpy,
                               double x, double y);
void canvas_arc(canvas target, double x, double y, double radius,
                double start, double end);
void canvas_arc_to(canvas target, double x1, double y1, double x2, double y2,
                   double radius);
void canvas_rect(canvas target, double x, double y, double width, double height);
void canvas_fill(canvas target);
void canvas_stroke(canvas target);
void canvas_clip(canvas target);
void canvas_fillrect(canvas target, double x, double y, double width, double height);
void canvas_strokeRect(canvas target, double x, double y, double width, double height);
void canvas_clearRect(canvas target, double x, double y, double width, double height);
void canvas_fillText(canvas target, const char *text, double x, double y);
void canvas_strokeText(canvas target, const char *text, double x, double y);
void canvas_set_fill_style(canvas target, const char *value);
void canvas_set_stroke_style(canvas target, const char *value);
void canvas_set_line_width(canvas target, double width);
void canvas_set_line_cap(canvas target, const char *value);
void canvas_set_line_join(canvas target, const char *value);
void canvas_set_miter_limit(canvas target, double value);
void canvas_set_global_alpha(canvas target, double value);
void canvas_set_font(canvas target, const char *value);
void canvas_set_text_align(canvas target, const char *value);
void canvas_set_text_baseline(canvas target, const char *value);
void canvas_translate(canvas target, double x, double y);
void canvas_rotate(canvas target, double angle);
void canvas_scale(canvas target, double x, double y);
void canvas_transform(canvas target, double a, double b, double c, double d,
                      double e, double f);
void canvas_reset_transform(canvas target);
void canvas_save(canvas target);
void canvas_restore(canvas target);
void canvas_set_composite_operation(canvas target, const char *value);
double canvas_measure_text(canvas target, const char *text);
void canvas_draw_image(canvas target, image source,
                       double x, double y, double width, double height);
void canvas_put_image_data(canvas target, void *image_data, double x, double y);
void *canvas_get_image_data(canvas target, double x, double y,
                            double width, double height);
const char *canvas_to_data_url(dom element, const char *mime);
promise canvas_to_blob(dom element, const char *mime);
int canvas_width(canvas target);
int canvas_height(canvas target);
void canvas_set_size(dom element, int width, int height);

void *image_data_create(int width, int height);
void *image_bitmap_from(void *source);
promise image_bitmap_decode(void *source);
void image_bitmap_close(image value);

/* -------------------------------------------------------------------------
 * Audio / media
 * ------------------------------------------------------------------------- */
audio audio_create(const char *url);
void audio_play(audio value);
void audio_pause(audio value);
void audio_load(audio value);
void audio_set_volume(audio value, double volume);
void audio_set_loop(audio value, int loop);
void audio_set_muted(audio value, int muted);
void audio_set_current_time(audio value, double time);
double audio_get_current_time(audio value);
double audio_get_duration(audio value);
int audio_is_paused(audio value);
int audio_ended(audio value);
void audio_set_playback_rate(audio value, double rate);

/* -------------------------------------------------------------------------
 * MediaDevices / camera / microphone
 * ------------------------------------------------------------------------- */
promise media_get_user_media(int audio_enabled, int video_enabled);
promise media_get_display_media(int audio_enabled, int video_enabled);
promise media_enumerate_devices(void);
void media_stop(media value);

/* -------------------------------------------------------------------------
 * Clipboard
 * ------------------------------------------------------------------------- */
promise clipboard_read_text(void);
promise clipboard_write_text(const char *text);

/* -------------------------------------------------------------------------
 * Geolocation
 * ------------------------------------------------------------------------- */
promise geolocation_current_position(void);
int geolocation_watch_position(void *callback);
void geolocation_clear_watch(int watch_id);

/* -------------------------------------------------------------------------
 * Notifications
 * ------------------------------------------------------------------------- */
promise notification_request_permission(void);
int notification_permission_granted(void);
void browser_notify(const char *title, const char *body);

/* -------------------------------------------------------------------------
 * Workers
 * ------------------------------------------------------------------------- */
worker worker_create(const char *url);
void worker_post_message(worker value, void *message);
void worker_terminate(worker value);
void worker_set_handlers(worker value, void *onmessage, void *onerror);

/* -------------------------------------------------------------------------
 * Web Crypto
 * ------------------------------------------------------------------------- */
promise crypto_random_uuid(void);
promise crypto_digest(const char *algorithm, void *data, int length);
promise crypto_random_bytes(int length);

/* -------------------------------------------------------------------------
 * DOM observers
 * ------------------------------------------------------------------------- */
observer mutation_observer_create(void *callback);
int mutation_observer_observe(observer value, dom target);
void mutation_observer_disconnect(observer value);
observer resize_observer_create(void *callback);
int resize_observer_observe(observer value, dom target);
void resize_observer_disconnect(observer value);
observer intersection_observer_create(void *callback);
int intersection_observer_observe(observer value, dom target);
void intersection_observer_disconnect(observer value);

/* -------------------------------------------------------------------------
 * Browser environment / diagnostics
 * ------------------------------------------------------------------------- */
int browser_is_secure_context(void);
int browser_has_api(const char *name);
const char *browser_last_error(void);
int browser_last_errno(void);
void browser_clear_error(void);
int browser_system(const char *javascript);

#endif
`,
};

/* Explicit unsupported-browser fallbacks for declared APIs. */
if (typeof impl.appendchild !== "function")
  impl.appendchild = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: appendchild"
    );
    return null;
  };
if (typeof impl.blur !== "function")
  impl.blur = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: blur"
    );
    return null;
  };
if (typeof impl.browser_set_cookie_ex !== "function")
  impl.browser_set_cookie_ex = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: browser_set_cookie_ex"
    );
    return null;
  };
if (typeof impl.canvas_clip !== "function")
  impl.canvas_clip = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: canvas_clip"
    );
    return null;
  };
if (typeof impl.canvas_reset_transform !== "function")
  impl.canvas_reset_transform = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: canvas_reset_transform"
    );
    return null;
  };
if (typeof impl.canvas_transform !== "function")
  impl.canvas_transform = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: canvas_transform"
    );
    return null;
  };
if (typeof impl.click !== "function")
  impl.click = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: click"
    );
    return null;
  };
if (typeof impl.createelement !== "function")
  impl.createelement = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: createelement"
    );
    return null;
  };
if (typeof impl.createelement_ns !== "function")
  impl.createelement_ns = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: createelement_ns"
    );
    return null;
  };
if (typeof impl.firstchild !== "function")
  impl.firstchild = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: firstchild"
    );
    return null;
  };
if (typeof impl.focus !== "function")
  impl.focus = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: focus"
    );
    return null;
  };
if (typeof impl.getelementbyid !== "function")
  impl.getelementbyid = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: getelementbyid"
    );
    return null;
  };
if (typeof impl.hasattribute !== "function")
  impl.hasattribute = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: hasattribute"
    );
    return null;
  };
if (typeof impl.insertbefore !== "function")
  impl.insertbefore = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: insertbefore"
    );
    return null;
  };
if (typeof impl.lastchild !== "function")
  impl.lastchild = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: lastchild"
    );
    return null;
  };
if (typeof impl.nextsibling !== "function")
  impl.nextsibling = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: nextsibling"
    );
    return null;
  };
if (typeof impl.parentnode !== "function")
  impl.parentnode = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: parentnode"
    );
    return null;
  };
if (typeof impl.prependchild !== "function")
  impl.prependchild = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: prependchild"
    );
    return null;
  };
if (typeof impl.previoussibling !== "function")
  impl.previoussibling = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: previoussibling"
    );
    return null;
  };
if (typeof impl.queryselector !== "function")
  impl.queryselector = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: queryselector"
    );
    return null;
  };
if (typeof impl.queryselectorall !== "function")
  impl.queryselectorall = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: queryselectorall"
    );
    return null;
  };
if (typeof impl.removeattribute !== "function")
  impl.removeattribute = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: removeattribute"
    );
    return null;
  };
if (typeof impl.removechild !== "function")
  impl.removechild = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: removechild"
    );
    return null;
  };
if (typeof impl.replacechild !== "function")
  impl.replacechild = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: replacechild"
    );
    return null;
  };
if (typeof impl.setattribute !== "function")
  impl.setattribute = (...args) => {
    setErrno(BROWC.errno.ENOSYS);
    globalThis.__BROWC_LAST_ERROR__ = new Error(
      "BrowC browser API unavailable: setattribute"
    );
    return null;
  };

/* ============================================================================
 * BrowC self-diagnostics
 * ========================================================================== */
export function browcSelfTest() {
  const problems = [];

  if (typeof BrowCToken !== "function") problems.push("BrowCToken missing");
  if (typeof BrowCLexer !== "function") problems.push("BrowCLexer missing");
  if (typeof BrowCStandardLibrary !== "function") {
    problems.push("BrowCStandardLibrary missing");
  }
  if (!Array.isArray(PUNCTUATORS)) problems.push("PUNCTUATORS missing");
  if (!KEYWORDS || typeof KEYWORDS.get !== "function")
    problems.push("KEYWORDS missing");

  for (const [name, fn] of Object.entries(impl)) {
    if (
      typeof fn !== "function" &&
      typeof fn !== "number" &&
      typeof fn !== "string" &&
      name !== "__browc_internal__"
    ) {
      problems.push(`stdlib implementation "${name}" is not callable`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    headers: typeof HEADERS === "object" ? Object.keys(HEADERS).length : 0,
    nativeFunctions: Object.keys(impl).length,
    browserAPIs:
      typeof HEADERS?.["browser.h"] === "string"
        ? (
            HEADERS["browser.h"].match(
              /^\s*(?:[A-Za-z_][A-Za-z0-9_]*\s+)+[A-Za-z_][A-Za-z0-9_]*\s*\(/gm
            ) || []
          ).length
        : 0,
  };
}

/* ========================================================================
 * HEADER / LIBRARY CLASS
 * ====================================================================== */
/* ========================================================================
 * NATIVE FUNCTION TABLE
 * ====================================================================== */
/*
 * Proxy means every registered implementation is callable as:
 *
 *   BrowCNativeFunctions.strlen("hello")
 *   BrowCNativeFunctions.malloc(128)
 *
 * and unknown functions still route through the main bridge/runtime.
 */
export const BrowCNativeFunctions = new Proxy(impl, {
  get(target, property) {
    if (typeof property !== "string") return target[property];
    if (typeof target[property] === "function") {
      return target[property];
    }
    return (...args) => browcCall(property, ...args);
  },
  has() {
    return true;
  },
});
/* ========================================================================
 * PUBLIC BRIDGE
 * ====================================================================== */
export function browcCall(name, ...args) {
  name = String(name);
  /*
   * Runtime has priority.
   */
  const runtimeResult = runtimeCall(name, args);
  if (runtimeResult !== undefined) {
    return runtimeResult;
  }
  /*
   * Built-in implementation.
   */
  const fn = impl[name];
  if (typeof fn !== "function") {
    throw new Error(
      `BrowC: standard-library element "${name}" is not implemented`
    );
  }
  return fn(...args);
}
/*
 * This is the bridge used by generated BrowC JavaScript.
 */
globalThis.__browcCall = browcCall;
/* ========================================================================
 * CONSTANTS / GLOBALS
 * ====================================================================== */
if (!globalThis.__BROWC_ERRNO__) {
  globalThis.__BROWC_ERRNO__ = 0;
}
if (hasDocument()) {
  initAllFiles();
  /*
   * stdout/stderr are BrowC pseudo FILE objects.
   * They are implemented as DOM nodes because the browser has no native
   * process stdout/stderr.
   */
  function ensureStream(name, streamType) {
    let stream = findFile(name);
    if (!stream) {
      stream = document.createElement(BROWC.FILE_TAG);
      stream.setAttribute("filename", name);
      stream.setAttribute("mode", streamType);
      stream.setAttribute("content", "");
      stream.hidden = true;
      (document.body || document.documentElement).appendChild(stream);
    }
    initFileState(stream);
    return stream;
  }
  globalThis.__BROWC_STDIN__ =
    globalThis.__BROWC_STDIN__ || ensureStream("__stdin__", "r");
  globalThis.__BROWC_STDOUT__ =
    globalThis.__BROWC_STDOUT__ || ensureStream("__stdout__", "w");
  globalThis.__BROWC_STDERR__ =
    globalThis.__BROWC_STDERR__ || ensureStream("__stderr__", "w");
}
/* C global handles */
if (!globalThis.stdin) {
  globalThis.stdin = globalThis.__BROWC_STDIN__ || null;
}
if (!globalThis.stdout) {
  globalThis.stdout = globalThis.__BROWC_STDOUT__ || null;
}
if (!globalThis.stderr) {
  globalThis.stderr = globalThis.__BROWC_STDERR__ || null;
}
/* ========================================================================
 * DEVELOPMENT / RUNTIME INSPECTION
 * ====================================================================== */
export function getBrowCFiles() {
  return fileElements();
}
export function getBrowCFile(filename) {
  return findFile(filename);
}
export function createBrowCFile(filename, content = "", mode = "w+") {
  const file = ensureFile(filename, mode);
  if (!file) {
    throw new Error("BrowC file system unavailable");
  }
  file.setAttribute("mode", mode);
  file.setAttribute("content", String(content));
  file.__browc_position = mode.startsWith("a") ? String(content).length : 0;
  return file;
}
export function getBrowCMemorySize(ptr) {
  return memorySize(ptr);
}
export function getBrowCErrno() {
  return getErrno();
}
export function getBrowCHeaders() {
  return { ...HEADERS };
}
export function getBrowCImplementationNames() {
  return Object.keys(impl);
}
export const BrowCConstants = {
  EOF: BROWC.EOF,
  EXIT_SUCCESS: 0,
  EXIT_FAILURE: 1,
  RAND_MAX: 2147483647,
  SEEK_SET: 0,
  SEEK_CUR: 1,
  SEEK_END: 2,
  ...BROWC.errno,
  M_E: 2.718281828459045,
  M_PI: Math.PI,
  M_PI_2: Math.PI / 2,
  M_PI_4: Math.PI / 4,
  M_SQRT2: Math.SQRT2,
  M_SQRT1_2: Math.SQRT1_2,
};
export default {
  BrowCStandardLibrary,
  BrowCNativeFunctions,
  BrowCConstants,
  browcCall,
  getBrowCFiles,
  getBrowCFile,
  createBrowCFile,
  getBrowCMemorySize,
  getBrowCErrno,
  getBrowCHeaders,
  getBrowCImplementationNames,
};
/*
 * NOTE: `globalThis.BrowCRuntime` is already the real, fully-functional
 * BrowCRuntimeClass singleton constructed above (`const BrowCRuntime = new
 * BrowCRuntimeClass(); ... globalThis.BrowCRuntime = BrowCRuntime;`), with
 * working currentContext(), runMain(), sizeof(), sizeofType(), alignof(),
 * cast(), addressOf(), deref() and executeJS() methods, plus a full libc
 * surface (malloc/printf/strlen/...) already bound onto globalThis by
 * installBrowCBuiltins(). An earlier revision of this file clobbered that
 * singleton here with a dummy stub object (no-op sizeof, `cast` that just
 * returned its input, `executeJS: eval`, etc.), which silently broke every
 * program relying on those semantics. That stub - and the toy `printf()`
 * that duplicated/shadowed the real impl.printf - have been removed.
 */

/* ============================================================
 * Full source -> preprocess -> parse -> compile -> run pipeline
 * ============================================================ */
function runBrowCSource(cSource, filename = "<script>") {
  const preprocessor = new BrowCPreprocessor({
    standardLibrary: typeof HEADERS !== "undefined" ? HEADERS : {},
    filename,
  });
  const preprocessed = preprocessor.preprocess(cSource, filename);
  const code =
    typeof preprocessed === "string" ? preprocessed : preprocessed.code;

  const parser = new BrowCParser(code, { filename });
  const ast = parser.parse();

  const jsCode = compileBrowCAST(ast, { filename });

  const runScript = new Function(jsCode);
  return runScript();
}
if (typeof globalThis !== "undefined") {
  globalThis.runBrowCSource = runBrowCSource;
}

// Auto-run all C script tags on DOMContentLoaded
if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
) {
  window.addEventListener("DOMContentLoaded", () => {
    const scripts = document.querySelectorAll('script[type="text/x-c"]');
    scripts.forEach((script) => {
      const cSource = script.textContent;
      const filename =
        script.getAttribute("filename") || script.src || "<script>";
      try {
        runBrowCSource(cSource, filename);
      } catch (err) {
        console.error("BrowC Compilation/Execution Error:", err);
      }
    });
  });
}

/* ============================================================================
 * BrowC safe global exports
 * ========================================================================== */
(function installBrowCGlobals(global) {
  if (!global || typeof global !== "object") return;

  const exports = {
    BrowCLexError:
      typeof BrowCLexError !== "undefined" ? BrowCLexError : undefined,
    BrowCToken: typeof BrowCToken !== "undefined" ? BrowCToken : undefined,
    BrowCParserToken:
      typeof BrowCParserToken !== "undefined" ? BrowCParserToken : undefined,
    BrowCLexer: typeof BrowCLexer !== "undefined" ? BrowCLexer : undefined,
    BrowCStandardLibrary:
      typeof BrowCStandardLibrary !== "undefined"
        ? BrowCStandardLibrary
        : typeof BrowCStandardLibraryImpl !== "undefined"
        ? BrowCStandardLibraryImpl
        : undefined,
    __BROWC_SAFETY__,
  };

  for (const [name, value] of Object.entries(exports)) {
    if (value !== undefined && !(name in global)) {
      try {
        Object.defineProperty(global, name, {
          value,
          writable: false,
          configurable: true,
          enumerable: false,
        });
      } catch (_) {
        // Some host globals are non-configurable. Do not crash initialization.
      }
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : window);

/* ============================================================
 * EXPORTS & GLOBAL BINDINGS
 * ============================================================
 */
/*
 * NOTE: BrowCPPTokenizer.prototype.tokenize and
 * BrowCPreprocessor.prototype.tokenizeLine are already defined correctly
 * above (inside their class bodies). Earlier revisions of this file
 * appended broken duplicate overrides here that called a nonexistent
 * `this.nextToken()` on BrowCPPTokenizer, which crashed the preprocessor
 * on the very first builtin macro it tried to tokenize. Those overrides
 * have been removed; the original class-body implementations are used.
 */ /* ============================================================
 * BrowC C99 semantic execution layer (patched)
 *
 * This layer intentionally executes the parsed C AST instead of translating
 * C operators directly to JavaScript operators.  It supplies the missing
 * semantic boundary: C types, lvalues, object storage, pointer arithmetic,
 * aggregate layout, conversions, control-flow signals, static locals, and
 * C-style main/exit behavior.
 *
 * It is installed below the legacy JS backend so existing public APIs remain
 * available.  The interpreter is the default program runner.
 * ============================================================ */
(function installBrowCC99SemanticLayer(global) {
  "use strict";

  if (!global || typeof global.parseBrowC !== "function") return;

  const rt = global.BrowCRuntime;

  const C = {
    void: { kind: "scalar", name: "void", size: 0, align: 1 },
    _Bool: { kind: "scalar", name: "_Bool", size: 1, align: 1 },
    char: { kind: "scalar", name: "char", size: 1, align: 1, signed: true },
    signed_char: {
      kind: "scalar",
      name: "signed char",
      size: 1,
      align: 1,
      signed: true,
    },
    unsigned_char: {
      kind: "scalar",
      name: "unsigned char",
      size: 1,
      align: 1,
      signed: false,
    },
    short: { kind: "scalar", name: "short", size: 2, align: 2, signed: true },
    unsigned_short: {
      kind: "scalar",
      name: "unsigned short",
      size: 2,
      align: 2,
      signed: false,
    },
    int: { kind: "scalar", name: "int", size: 4, align: 4, signed: true },
    unsigned_int: {
      kind: "scalar",
      name: "unsigned int",
      size: 4,
      align: 4,
      signed: false,
    },
    long: { kind: "scalar", name: "long", size: 8, align: 8, signed: true },
    unsigned_long: {
      kind: "scalar",
      name: "unsigned long",
      size: 8,
      align: 8,
      signed: false,
    },
    long_long: {
      kind: "scalar",
      name: "long long",
      size: 8,
      align: 8,
      signed: true,
    },
    unsigned_long_long: {
      kind: "scalar",
      name: "unsigned long long",
      size: 8,
      align: 8,
      signed: false,
    },
    float: { kind: "scalar", name: "float", size: 4, align: 4, float: true },
    double: { kind: "scalar", name: "double", size: 8, align: 8, float: true },
    long_double: {
      kind: "scalar",
      name: "long double",
      size: 8,
      align: 8,
      float: true,
    },
    pointerSize: 4,
  };

  const cloneType = (t) => (t ? { ...t } : C.int);
  const alignUp = (n, a) => Math.ceil(n / Math.max(1, a)) * Math.max(1, a);
  const isPtr = (t) => t && t.kind === "pointer";
  const isArray = (t) => t && t.kind === "array";
  const isAgg = (t) => t && (t.kind === "struct" || t.kind === "union");
  const isInt = (t) =>
    t && t.kind === "scalar" && !t.float && t.name !== "void";
  const isFloat = (t) => t && t.kind === "scalar" && !!t.float;

  class CCell {
    constructor(type, value, meta = {}) {
      this.type = type;
      this.value = value;
      this.meta = meta;
      this.const = !!meta.const;
    }
  }
  class CEnv {
    constructor(parent = null) {
      this.parent = parent;
      this.map = new Map();
    }
    define(name, cell) {
      this.map.set(name, cell);
      return cell;
    }
    hasLocal(name) {
      return this.map.has(name);
    }
    lookup(name) {
      if (this.map.has(name)) return this.map.get(name);
      if (this.parent) return this.parent.lookup(name);
      return null;
    }
  }
  class CRefPointer {
    constructor(target, stride = 1, index = 0, pointee = null) {
      this.__browc_pointer = true;
      this.target = target;
      this.stride = stride;
      this.index = index;
      this.pointee = pointee;
    }
    get valid() {
      return !!this.target;
    }
    get address() {
      if (!this.target) return 0;
      if (this.target.addressBase != null)
        return this.target.addressBase + this.index * this.stride;
      if (!this.target._ptrId) this.target._ptrId = CRefPointer.nextId++;
      return this.target._ptrId * 0x100 + this.index * this.stride;
    }
    clone() {
      return new CRefPointer(
        this.target,
        this.stride,
        this.index,
        this.pointee
      );
    }
    add(n) {
      return new CRefPointer(
        this.target,
        this.stride,
        this.index + toSafeInt(n),
        this.pointee
      );
    }
    subtract(n) {
      return this.add(-toSafeInt(n));
    }
    difference(o) {
      if (!(o instanceof CRefPointer) || o.target !== this.target)
        throw new Error(
          "pointer subtraction requires pointers to the same array object"
        );
      return this.index - o.index;
    }
    get() {
      if (!this.target) throw new Error("null pointer dereference");
      return this.targetAt().value;
    }
    set(v) {
      const c = this.targetAt();
      if (c.const) throw new Error("assignment of read-only object");
      c.value = convert(v, c.type);
      return c.value;
    }
    targetAt() {
      if (this.target.kind === "cell") {
        if (this.index !== 0)
          throw new Error("pointer arithmetic outside scalar object");
        return this.target.cell;
      }
      if (this.target.kind === "array") {
        if (this.index < 0 || this.index >= this.target.cells.length)
          throw new Error("array pointer out of bounds");
        return this.target.cells[this.index];
      }
      if (this.target.kind === "members") {
        if (this.index !== 0)
          throw new Error("invalid member pointer arithmetic");
        return this.target.cell;
      }
      throw new Error("invalid pointer target");
    }
  }
  CRefPointer.nextId = 1;

  function toSafeInt(x) {
    if (typeof x === "bigint") return Number(x);
    const n = Number(x);
    if (!Number.isFinite(n)) throw new Error("integer conversion overflow");
    return Math.trunc(n);
  }
  function typeKey(t) {
    if (!t) return "?";
    if (t.kind === "pointer") return "*" + typeKey(t.to);
    if (t.kind === "array") return "[" + t.length + "]" + typeKey(t.of);
    if (isAgg(t)) return t.kind + ":" + (t.tag || "");
    return t.name || t.kind;
  }
  function integerRange(t) {
    const bits = t.size * 8;
    if (!t.signed) return { min: 0n, max: (1n << BigInt(bits)) - 1n };
    const m = 1n << BigInt(bits - 1);
    return { min: -m, max: m - 1n };
  }
  function convert(v, t) {
    if (!t) return v;
    if (isPtr(t)) {
      if (v == null || v === 0 || v === false) return null;
      if (t.to?.kind === "function" && v?.__cfunction) return v;
      if (v && v.__browc_pointer) {
        if (v instanceof CRefPointer)
          return new CRefPointer(v.target, v.stride, v.index, t.to);
        if (v.clone) {
          const p = v.clone();
          p.pointee = t.to;
          return p;
        }
        v.pointee = t.to;
        return v;
      }
      throw new Error("cannot convert value to pointer");
    }
    if (t.kind === "array" || isAgg(t)) return v;
    if (t.name === "_Bool") return truth(v) ? 1 : 0;
    if (isFloat(t))
      return t.name === "float" ? Math.fround(Number(v)) : Number(v);
    if (isInt(t)) {
      let n = typeof v === "bigint" ? v : BigInt(Math.trunc(Number(v) || 0));
      const r = integerRange(t);
      const mod = 1n << BigInt(t.size * 8);
      n = ((n % mod) + mod) % mod;
      if (t.signed && n > r.max) n -= mod;
      return t.size >= 8 ? n : Number(n);
    }
    return v;
  }
  function truth(v) {
    if (v && v.__browc_pointer) return !!v.valid;
    return Number(v) !== 0 || (typeof v === "bigint" && v !== 0n);
  }
  function promote(t) {
    if (!isInt(t)) return t;
    if (t.size < 4) return t.signed ? C.int : C.unsigned_int;
    return t;
  }
  function commonInt(a, b) {
    a = promote(a);
    b = promote(b);
    if (a.float || b.float) return C.double;
    if (a.size !== b.size) return a.size > b.size ? a : b;
    if (a.signed === b.signed) return a;
    return a.signed ? b : a;
  }
  function binaryType(a, b, op) {
    if (
      op === "&&" ||
      op === "||" ||
      op === "==" ||
      op === "!=" ||
      op === "<" ||
      op === ">" ||
      op === "<=" ||
      op === ">="
    )
      return C.int;
    if (isPtr(a) || isPtr(b)) return a;
    if (isFloat(a) || isFloat(b)) return C.double;
    return commonInt(a, b);
  }

  function baseType(specs, interp) {
    const vals = (specs || []).map((s) => s.name || s.value || s.type || "");
    const joined = vals.join(" ");
    if (vals.some((x) => x === "_Bool")) return C._Bool;
    if (vals.some((x) => x === "_Complex"))
      return { kind: "complex", base: C.double, size: 16, align: 8 };
    if (vals.some((x) => x === "_Imaginary"))
      return { kind: "imaginary", base: C.double, size: 8, align: 8 };
    if (vals.includes("void")) return C.void;
    if (vals.includes("char"))
      return vals.includes("unsigned")
        ? C.unsigned_char
        : vals.includes("signed")
        ? C.signed_char
        : C.char;
    if (vals.includes("short"))
      return vals.includes("unsigned") ? C.unsigned_short : C.short;
    if (vals.includes("long") && vals.filter((x) => x === "long").length >= 2)
      return vals.includes("unsigned") ? C.unsigned_long_long : C.long_long;
    if (vals.includes("long"))
      return vals.includes("unsigned") ? C.unsigned_long : C.long;
    if (
      vals.includes("int") ||
      vals.includes("signed") ||
      vals.includes("unsigned")
    )
      return vals.includes("unsigned") ? C.unsigned_int : C.int;
    if (vals.includes("float")) return C.float;
    if (vals.includes("double"))
      return vals.includes("long") ? C.long_double : C.double;
    const td = vals.find((v) => interp && interp.typedefs.has(v));
    if (td) return interp.typedefs.get(td);
    const ag = (specs || []).find((s) => s.type === "StructOrUnionSpecifier");
    if (ag) return interp.structType(ag);
    const en = (specs || []).find((s) => s.type === "EnumSpecifier");
    if (en) return C.int;
    return C.int;
  }
  function applyDeclarator(type, d, interp) {
    if (!d) return type;
    const ptrs = [];
    if (d.pointer) {
      let p = d.pointer;
      while (p) {
        ptrs.push(p);
        p = p.next;
      }
    }
    let inner = type;
    const direct = d.direct || d;
    let derived;
    if (direct && direct.type === "ArrayDeclarator") {
      const len = direct.size ? toSafeInt(interp.evalConst(direct.size)) : null;
      derived = { kind: "array", of: null, length: len, cells: [] };
      derived.of = applyDeclarator(inner, direct.declarator, interp);
      inner = derived;
    } else if (direct && direct.type === "FunctionDeclarator") {
      derived = {
        kind: "function",
        returnType: inner,
        parameters: direct.parameters || [],
        variadic: !!direct.variadic,
      };
      inner = derived;
      if (direct.declarator)
        inner = applyDeclarator(inner, direct.declarator, interp);
    } else if (
      direct &&
      direct.declarator &&
      direct.type !== "IdentifierDeclarator"
    ) {
      inner = applyDeclarator(inner, direct.declarator, interp);
    }
    for (let i = ptrs.length - 1; i >= 0; i--)
      inner = {
        kind: "pointer",
        to: inner,
        size: C.pointerSize,
        align: C.pointerSize,
        qualifiers: ptrs[i].qualifiers || [],
      };
    return inner;
  }

  class BrowCC99Interpreter {
    constructor(ast, options = {}) {
      this.ast = ast;
      this.options = options;
      this.global = new CEnv();
      this.structs = new Map();
      this.unions = new Map();
      this.typedefs = new Map();
      this.enums = new Map();
      this.functions = new Map();
      this.staticCells = new Map();
      this.labels = new Map();
      this.collect();
    }
    declaratorName(d) {
      if (!d) return null;
      if (d.name) return d.name;
      if (d.type === "IdentifierDeclarator") return d.name;
      if (d.direct) return this.declaratorName(d.direct);
      if (d.declarator) return this.declaratorName(d.declarator);
      return null;
    }
    structType(s) {
      const map = s.kind === "union" ? this.unions : this.structs;
      const tag = s.tag || "";
      if (map.has(tag) && !s.fields) return map.get(tag);
      const t = { kind: s.kind, tag, size: 0, align: 1, fields: new Map() };
      map.set(tag, t);
      let off = 0,
        max = 0;
      for (const f of s.fields || []) {
        const ft = baseType(f.specifiers, this);
        for (const fd of f.declarators || []) {
          let dt = applyDeclarator(ft, fd.declarator, this);
          const name = this.declaratorName(fd.declarator);
          if (!name) continue;
          const a = this.alignof(dt);
          if (s.kind === "union") off = 0;
          else off = alignUp(off, a);
          const field = { name, type: dt, offset: off };
          t.fields.set(name, field);
          if (s.kind === "union") max = Math.max(max, this.sizeofType(dt));
          else off += this.sizeofType(dt);
          if (s.kind === "union") max = Math.max(max, this.sizeofType(dt));
        }
      }
      t.size = alignUp(s.kind === "union" ? max : off, t.align);
      for (const f of t.fields.values())
        t.align = Math.max(t.align, this.alignof(f.type));
      t.size = alignUp(s.kind === "union" ? max : off, t.align);
      return t;
    }
    collect() {
      for (const d of this.ast.declarations || []) {
        if (d.type === "FunctionDefinition") {
          const n = this.declaratorName(d.declarator);
          if (n) this.functions.set(n, d);
        } else if (d.type === "Declaration") {
          const typedef = d.specifiers?.some(
            (s) => s.type === "StorageClassSpecifier" && s.value === "typedef"
          );
          for (const x of d.declarators || []) {
            const n = this.declaratorName(x.declarator);
            if (!n) continue;
            const t = applyDeclarator(
              baseType(d.specifiers, this),
              x.declarator,
              this
            );
            if (typedef) this.typedefs.set(n, t);
          }
          for (const s of d.specifiers || [])
            if (s.type === "StructOrUnionSpecifier") this.structType(s);
          for (const s of d.specifiers || [])
            if (s.type === "EnumSpecifier") {
              let next = 0;
              for (const e of s.enumerators || []) {
                const v = e.value ? this.evalConst(e.value) : next;
                this.enums.set(e.name, v);
                next = Number(v) + 1;
              }
            }
        }
      }
      for (const d of this.ast.declarations || [])
        if (d.type === "Declaration") this.declareGlobal(d);
    }
    sizeofType(t) {
      if (!t) return 0;
      if (t.kind === "pointer") return C.pointerSize;
      if (t.kind === "array")
        return t.length == null ? 0 : this.sizeofType(t.of) * t.length;
      if (t.kind === "function") return 0;
      if (t.kind === "struct" || t.kind === "union") return t.size;
      if (t.kind === "complex") return 16;
      return t.size || 4;
    }
    alignof(t) {
      if (!t) return 1;
      if (t.kind === "array") return this.alignof(t.of);
      return t.align || Math.min(this.sizeofType(t) || 1, 8);
    }
    defaultValue(t, staticStorage = false) {
      if (t.kind === "array") {
        const n = t.length == null ? 0 : t.length;
        const cells = [];
        for (let i = 0; i < n; i++)
          cells.push(new CCell(t.of, this.defaultValue(t.of, staticStorage)));
        return cells;
      }
      if (t.kind === "struct" || t.kind === "union") {
        const o = {};
        for (const [n, f] of t.fields)
          o[n] = new CCell(f.type, this.defaultValue(f.type, staticStorage));
        return o;
      }
      if (t.kind === "pointer") return null;
      if (t.name === "void") return undefined;
      if (t.name === "float" || t.name === "double" || t.name === "long double")
        return 0;
      if (t.name === "_Bool" || isInt(t)) return 0;
      if (t.kind === "complex") return { re: 0, im: 0 };
      return 0;
    }
    allocateObject(t, initial, meta = {}) {
      const cell = new CCell(
        t,
        initial === undefined
          ? this.defaultValue(t, !!meta.static)
          : convert(initial, t),
        meta
      );
      return cell;
    }
    declareGlobal(d) {
      const typedef = d.specifiers?.some(
        (s) => s.type === "StorageClassSpecifier" && s.value === "typedef"
      );
      if (typedef) return;
      for (const x of d.declarators || []) {
        const n = this.declaratorName(x.declarator);
        if (!n) continue;
        const t = applyDeclarator(
          baseType(d.specifiers, this),
          x.declarator,
          this
        );
        if (t.kind === "function") {
          continue;
        }
        const staticStorage = d.specifiers?.some(
          (s) =>
            s.type === "StorageClassSpecifier" &&
            (s.value === "static" || s.value === "extern")
        );
        if (
          d.specifiers?.some(
            (s) => s.type === "StorageClassSpecifier" && s.value === "extern"
          ) &&
          !x.initializer &&
          !this.global.hasLocal(n)
        )
          continue;
        const cell = this.allocateObject(t, undefined, {
          static: staticStorage || true,
        });
        if (x.initializer) this.initialize(cell, x.initializer);
        this.global.define(n, cell);
      }
    }
    initialize(cell, init, env = this.global) {
      if (!init) return;
      if (init.type === "InitializerList") {
        this.initList(cell, init, env);
        return;
      }
      cell.value = convert(this.eval(init, env), cell.type);
    }
    initList(cell, list, env = this.global) {
      if (cell.type.kind === "array") {
        let i = 0;
        for (const item of list.items || []) {
          let idx = i;
          for (const d of item.designators || [])
            if (d.type === "IndexDesignator")
              idx = toSafeInt(this.evalConst(d.expression || d.index));
          if (idx >= 0 && idx < cell.value.length) {
            this.initialize(cell.value[idx], item.initializer, env);
          }
          i = idx + 1;
        }
        return;
      }
      if (cell.type.kind === "struct" || cell.type.kind === "union") {
        let names = [...cell.type.fields.keys()],
          i = 0;
        for (const item of list.items || []) {
          let name = names[i];
          for (const d of item.designators || [])
            if (d.type === "FieldDesignator") name = d.name || d.field;
          if (name && cell.value[name])
            this.initialize(cell.value[name], item.initializer, env);
          i = Math.max(i, names.indexOf(name) + 1);
        }
      }
    }
    evalConst(n) {
      const v = this.value(n);
      return v;
    }
    value(n) {
      const r = this.eval(n, this.global);
      return r && r.__cell ? r.value : r;
    }
    lvalue(n, env) {
      if (n.type === "Identifier") {
        const c = env.lookup(n.name);
        if (!c) throw new Error(`undeclared identifier '${n.name}'`);
        return c;
      }
      if (n.type === "ParenthesizedExpression")
        return this.lvalue(n.expression, env);
      if (n.type === "UnaryExpression" && n.operator === "*") {
        const p = this.value(n.argument, env);
        return this.derefCell(p);
      }
      if (n.type === "MemberExpression") {
        let oc = this.lvalue(n.object, env);
        if (n.throughPointer) {
          const p = this.eval(n.object, env);
          oc = this.derefCell(p);
        }
        const ot = oc.type;
        const f = ot?.fields?.get(n.member);
        if (!f) throw new Error(`no member '${n.member}'`);
        return oc.value[n.member];
      }
      if (n.type === "ArraySubscriptExpression") {
        const idx = toSafeInt(this.eval(n.index, env));
        const oc = this.lvalue(n.object, env);
        if (oc.type?.kind === "array") return oc.value[idx];
        const base = this.eval(n.object, env);
        if (base && base.__browc_pointer) return this.derefCell(base.add(idx));
        throw new Error("subscripted value is not an array or pointer");
      }
      throw new Error(`expression is not an lvalue: ${n.type}`);
    }
    makePointer(cell, type, container = null, index = 0) {
      if (container)
        return new CRefPointer(container, this.sizeofType(type), index, type);
      return new CRefPointer(
        { kind: "cell", cell },
        this.sizeofType(type),
        0,
        type
      );
    }
    derefCell(p) {
      if (!p || !p.__browc_pointer)
        throw new Error("invalid/null pointer dereference");
      if (p instanceof CRefPointer) return p.targetAt();
      if (p.get && p.set)
        return new CCell(p.pointee || C.char, p.get(), { externalPointer: p });
      return this.runtimePointerCell(p);
    }
    runtimePointerCell(p) {
      const t = p.pointee || C.char;
      const value = this.loadPointer(p, t);
      return new CCell(t, value, { externalPointer: p });
    }
    loadPointer(p, t) {
      if (!global.BrowCRuntime) return 0;
      const m = global.BrowCRuntime;
      if (t.kind === "pointer") {
        const a = m.load32(p);
        const q = m.memory.pointerFromAddress(a);
        if (q) q.pointee = t.to;
        return q;
      }
      if (t.name === "char" || t.name === "signed char") return m.load8(p);
      if (t.name === "unsigned char") return m.loadU8(p);
      if (t.name === "short") return m.load16(p);
      if (t.name === "unsigned short") return m.loadU16(p);
      if (t.name === "int") return m.load32(p);
      if (t.name === "unsigned int") return m.loadU32(p);
      if (t.name === "float") return m.loadFloat(p);
      if (t.name === "double") return m.loadDouble(p);
      return p.readUint8 ? p.readUint8() : 0;
    }
    storePointer(p, t, v) {
      const m = global.BrowCRuntime;
      if (t.kind === "pointer") return m.store32(p, v?.address || 0);
      if (t.name === "char" || t.name === "signed char") return m.store8(p, v);
      if (t.name === "unsigned char") return m.storeU8(p, v);
      if (t.name === "short") return m.store16(p, v);
      if (t.name === "unsigned short") return m.storeU16(p, v);
      if (t.name === "int") return m.store32(p, v);
      if (t.name === "unsigned int") return m.storeU32(p, v);
      if (t.name === "float") return m.storeFloat(p, v);
      if (t.name === "double") return m.storeDouble(p, v);
      return p.writeUint8(v);
    }
    value(n, env) {
      return this.eval(n, env);
    }
    eval(n, env) {
      if (!n) return undefined;
      switch (n.type) {
        case "NumericLiteral":
          return parseCNumber(String(n.value));
        case "CharacterLiteral":
          return decodeCChar(n.value);
        case "StringLiteral": {
          const s = (n.parts || []).map((x) => decodeCString(x)).join("");
          const bytes = new TextEncoder().encode(s + "\0");
          const p = global.BrowCRuntime.memory
            .allocate(bytes.length, { stringLiteral: true })
            .pointer(0, C.char);
          p.block.bytes.set(bytes);
          return p;
        }
        case "Identifier": {
          const c = env.lookup(n.name);
          if (c) {
            if (c.type?.kind === "array")
              return new CRefPointer(
                { kind: "array", cells: c.value },
                this.sizeofType(c.type.of),
                0,
                c.type.of
              );
            return c.value;
          }
          if (this.enums.has(n.name)) return this.enums.get(n.name);
          if (this.functions.has(n.name)) return this.functionValue(n.name);
          const g = global[n.name];
          if (g !== undefined) return g;
          const native = typeof impl !== "undefined" && impl[n.name];
          if (typeof native === "function") return native;
          throw new Error(`undeclared identifier '${n.name}'`);
        }
        case "ParenthesizedExpression":
          return this.eval(n.expression, env);
        case "UnaryExpression":
          return this.evalUnary(n, env);
        case "BinaryExpression":
          return this.evalBinary(n, env);
        case "AssignmentExpression":
          return this.evalAssignment(n, env);
        case "ConditionalExpression":
          return truth(this.eval(n.condition, env))
            ? this.eval(n.thenExpression, env)
            : this.eval(n.elseExpression, env);
        case "CommaExpression": {
          let v;
          for (const e of n.expressions || []) v = this.eval(e, env);
          return v;
        }
        case "ArraySubscriptExpression":
          return this.lvalue(n, env).value;
        case "MemberExpression":
          return this.lvalue(n, env).value;
        case "CastExpression":
          return convert(
            this.eval(n.expression, env),
            this.typeFromTypeName(n.targetType)
          );
        case "TypeUnaryExpression":
          return this.sizeofType(this.typeFromTypeName(n.targetType));
        case "CallExpression":
          return this.evalCall(n, env);
        case "BrowCJSExpression":
          return this.evalJS(n, env);
        case "CompoundLiteral": {
          const t = this.typeFromTypeName(n.type);
          const c = this.allocateObject(t);
          this.initialize(c, n.initializer);
          c.__aggregateCell = true;
          c.__arrayCell = t.kind === "array";
          return c.value;
        }
        default:
          throw new Error(`unsupported expression '${n.type}'`);
      }
    }
    typeFromTypeName(tn) {
      return applyDeclarator(
        baseType(tn?.specifiers || [], this),
        tn?.declarator,
        this
      );
    }
    evalUnary(n, env) {
      const op = n.operator;
      if (op === "sizeof") {
        return this.sizeofExpr(n.argument, env);
      }
      if (op === "&") {
        if (
          n.argument?.type === "Identifier" &&
          this.functions.has(n.argument.name)
        )
          return this.functionValue(n.argument.name);
        const c = this.lvalue(n.argument, env);
        let t = c.type;
        const ptrType = { kind: "pointer", to: t, size: 4, align: 4 };
        if (c.meta?.externalPointer) return c.meta.externalPointer;
        if (c.__container)
          return new CRefPointer(
            c.__container,
            this.sizeofType(t),
            c.__index,
            t
          );
        return this.makePointer(c, t);
      }
      if (op === "*") {
        return this.derefCell(this.eval(n.argument, env)).value;
      }
      if (op === "!") return truth(this.eval(n.argument, env)) ? 0 : 1;
      if (op === "~") {
        const t = promote(this.inferType(n.argument, env));
        const v = convert(this.eval(n.argument, env), t);
        return convert(~Number(v), t);
      }
      if (op === "+") return this.eval(n.argument, env);
      if (op === "-") {
        const v = this.eval(n.argument, env);
        return typeof v === "bigint" ? -v : -Number(v);
      }
      if (op === "++" || op === "--") {
        const c = this.lvalue(n.argument, env);
        const old = c.value;
        const t = c.type;
        const nv = this.evalBinary(
          {
            operator: op === "++" ? "+" : "-",
            left: { type: "NumericLiteral", value: "1" },
            right: { type: "NumericLiteral", value: "1" },
          },
          env
        );
        c.value = convert(Number(old) + (op === "++" ? 1 : -1), t);
        return n.prefix ? c.value : old;
      }
      throw new Error(`unsupported unary operator '${op}'`);
    }
    evalBinary(n, env) {
      const op = n.operator;
      if (op === "&&") {
        const a = this.eval(n.left, env);
        return truth(a) ? (truth(this.eval(n.right, env)) ? 1 : 0) : 0;
      }
      if (op === "||") {
        const a = this.eval(n.left, env);
        return truth(a) ? 1 : truth(this.eval(n.right, env)) ? 1 : 0;
      }
      const a = this.eval(n.left, env),
        b = this.eval(n.right, env);
      if (isPointerValue(a) || isPointerValue(b)) {
        if (op === "+") {
          if (isPointerValue(a)) return a.add(toSafeInt(b));
          if (isPointerValue(b)) return b.add(toSafeInt(a));
        }
        if (op === "-") {
          if (isPointerValue(a) && isPointerValue(b)) return a.difference(b);
          if (isPointerValue(a)) return a.subtract(toSafeInt(b));
        }
        if (["==", "!="].includes(op))
          return (a?.address || 0) === (b?.address || 0)
            ? op === "=="
              ? 1
              : 0
            : op === "=="
            ? 0
            : 1;
        if (["<", ">", "<=", ">="].includes(op)) {
          const x = a?.address || 0,
            y = b?.address || 0;
          return op === "<"
            ? x < y
            : op === ">"
            ? x > y
            : op === "<="
            ? x <= y
            : x >= y;
        }
      }
      if (
        op === "==" ||
        op === "!=" ||
        op === "<" ||
        op === ">" ||
        op === "<=" ||
        op === ">="
      ) {
        const x = Number(a),
          y = Number(b);
        return op === "=="
          ? x === y
            ? 1
            : 0
          : op === "!="
          ? x !== y
            ? 1
            : 0
          : op === "<"
          ? x < y
            ? 1
            : 0
          : op === ">"
          ? x > y
            ? 1
            : 0
          : op === "<="
          ? x <= y
            ? 1
            : 0
          : x >= y
          ? 1
          : 0;
      }
      if (
        op === "+" ||
        op === "-" ||
        op === "*" ||
        op === "/" ||
        op === "%" ||
        op === "<<" ||
        op === ">>" ||
        op === "&" ||
        op === "|" ||
        op === "^"
      ) {
        const t = binaryType(
          this.inferType(n.left, env),
          this.inferType(n.right, env),
          op
        );
        if (isFloat(t)) {
          const x = Number(a),
            y = Number(b);
          return op === "+"
            ? x + y
            : op === "-"
            ? x - y
            : op === "*"
            ? x * y
            : op === "/"
            ? x / y
            : op === "% "
            ? x % y
            : 0;
        }
        let x = typeof a === "bigint" ? a : BigInt(Math.trunc(Number(a))),
          y = typeof b === "bigint" ? b : BigInt(Math.trunc(Number(b)));
        let z =
          op === "+"
            ? x + y
            : op === "-"
            ? x - y
            : op === "*"
            ? x * y
            : op === "/"
            ? y === 0n
              ? (() => {
                  throw new Error("division by zero");
                })()
              : x / y
            : op === "%"
            ? y === 0n
              ? (() => {
                  throw new Error("division by zero");
                })()
              : x % y
            : op === "<<"
            ? x << y
            : op === ">>"
            ? x >> y
            : op === "&"
            ? x & y
            : op === "|"
            ? x | y
            : x ^ y;
        return convert(z, t);
      }
      throw new Error(`unsupported binary operator '${op}'`);
    }
    evalAssignment(n, env) {
      const c = this.lvalue(n.left, env);
      if (c.const) throw new Error("assignment of read-only object");
      const r = this.eval(n.right, env);
      let v;
      if (n.operator === "=") v = convert(r, c.type);
      else {
        const op = n.operator.slice(0, -1);
        v = convert(
          this.evalBinary(
            {
              operator: op,
              left: { type: "NumericLiteral", value: String(c.value) },
              right: { type: "NumericLiteral", value: String(r) },
            },
            env
          ),
          c.type
        );
      }
      if (c.meta?.externalPointer) {
        this.storePointer(c.meta.externalPointer, c.type, v);
      }
      c.value = v;
      return v;
    }
    evalCall(n, env) {
      const cal = this.eval(n.callee, env);
      const args = (n.arguments || []).map((x) => this.eval(x, env));
      if (cal && cal.__cfunction) return cal.call(args);
      if (typeof cal === "function") return cal(...args);
      throw new Error("called object is not a function");
    }
    functionValue(name) {
      const self = this,
        d = this.functions.get(name);
      return {
        __cfunction: true,
        call(args) {
          return self.callFunction(d, args, name);
        },
      };
    }
    callFunction(d, args, name) {
      const env = new CEnv(this.global);
      const fd = this.findFunctionDeclarator(d.declarator);
      const params = fd?.parameters || [];
      for (let i = 0; i < params.length; i++) {
        const p = params[i],
          pn = this.declaratorName(p.declarator);
        if (!pn) continue;
        let pt = applyDeclarator(
          baseType(p.specifiers, this),
          p.declarator,
          this
        );
        if (pt.kind === "array")
          pt = { kind: "pointer", to: pt.of, size: 4, align: 4 };
        env.define(pn, new CCell(pt, convert(args[i], pt)));
      }
      try {
        this.execStatement(d.body, env);
      } catch (e) {
        if (e instanceof CReturn)
          return convert(e.value, baseType(d.specifiers, this));
        throw e;
      }
      return 0;
    }
    findFunctionDeclarator(d) {
      if (!d) return null;
      if (d.type === "FunctionDeclarator") return d;
      if (d.direct) return this.findFunctionDeclarator(d.direct);
      if (d.declarator) return this.findFunctionDeclarator(d.declarator);
      return null;
    }
    execCompound(node, env) {
      const local = new CEnv(env);
      const body = node.body || [];
      const labels = new Map();
      for (let i = 0; i < body.length; i++)
        if (body[i]?.type === "LabeledStatement") labels.set(body[i].label, i);
      let pc = 0;
      while (pc < body.length) {
        try {
          this.execStatement(body[pc], local);
          pc++;
        } catch (e) {
          if (e instanceof CGoto) {
            if (labels.has(e.label)) {
              pc = labels.get(e.label);
              continue;
            }
            throw e;
          }
          throw e;
        }
      }
    }
    execStatement(n, env) {
      if (!n) return;
      switch (n.type) {
        case "CompoundStatement":
          return this.execCompound(n, env);
        case "Declaration":
          return this.execDeclaration(n, env);
        case "ExpressionStatement":
          this.eval(n.expression, env);
          return;
        case "ReturnStatement":
          throw new CReturn(
            n.expression ? this.eval(n.expression, env) : undefined
          );
        case "IfStatement":
          if (truth(this.eval(n.condition, env)))
            this.execStatement(n.thenBranch, env);
          else this.execStatement(n.elseBranch, env);
          return;
        case "WhileStatement":
          while (truth(this.eval(n.condition, env))) {
            try {
              this.execStatement(n.body, env);
            } catch (e) {
              if (e instanceof CContinue) continue;
              if (e instanceof CBreak) break;
              throw e;
            }
          }
          return;
        case "DoWhileStatement":
          do {
            try {
              this.execStatement(n.body, env);
            } catch (e) {
              if (e instanceof CContinue) {
              } else if (e instanceof CBreak) break;
              else throw e;
            }
          } while (truth(this.eval(n.condition, env)));
          return;
        case "ForStatement": {
          const e = new CEnv(env);
          if (n.init) {
            if (n.init.type === "Declaration") this.execDeclaration(n.init, e);
            else this.eval(n.init, e);
          }
          while (!n.condition || truth(this.eval(n.condition, e))) {
            try {
              this.execStatement(n.body, e);
            } catch (x) {
              if (x instanceof CBreak) break;
              if (!(x instanceof CContinue)) throw x;
            }
            if (n.iteration) this.eval(n.iteration, e);
          }
          return;
        }
        case "BreakStatement":
          throw new CBreak();
        case "ContinueStatement":
          throw new CContinue();
        case "GotoStatement":
          throw new CGoto(n.label);
        case "LabeledStatement":
          try {
            return this.execStatement(n.statement, env);
          } catch (e) {
            if (e instanceof CGoto && e.label === n.label)
              return this.execStatement(n.statement, env);
            throw e;
          }
        case "SwitchStatement":
          return this.execSwitch(n, env);
        case "CaseStatement":
          return this.execStatement(n.statement, env);
        case "DefaultStatement":
          return this.execStatement(n.statement, env);
        case "NullStatement":
          return;
        case "BrowCJSStatement":
          this.evalJS(n, env);
          return;
        default:
          throw new Error(`unsupported statement '${n.type}'`);
      }
    }
    execSwitch(n, env) {
      const v = this.eval(n.expression, env),
        body = n.body?.body || [];
      let start = -1,
        def = -1;
      for (let i = 0; i < body.length; i++) {
        const s = body[i];
        if (
          s.type === "CaseStatement" &&
          Number(this.eval(s.expression, env)) === Number(v) &&
          start < 0
        )
          start = i;
        if (s.type === "DefaultStatement") def = i;
      }
      if (start < 0) start = def;
      if (start < 0) return;
      for (let i = start; i < body.length; i++) {
        try {
          this.execStatement(body[i], env);
        } catch (e) {
          if (e instanceof CBreak) return;
          if (
            e instanceof CContinue ||
            e instanceof CReturn ||
            e instanceof CGoto
          )
            throw e;
          throw e;
        }
      }
    }
    execDeclaration(n, env) {
      const typedef = n.specifiers?.some(
        (s) => s.type === "StorageClassSpecifier" && s.value === "typedef"
      );
      if (typedef) {
        for (const x of n.declarators || []) {
          const name = this.declaratorName(x.declarator);
          if (name)
            this.typedefs.set(
              name,
              applyDeclarator(baseType(n.specifiers, this), x.declarator, this)
            );
        }
        return;
      }
      for (const x of n.declarators || []) {
        const name = this.declaratorName(x.declarator);
        if (!name) continue;
        const t = applyDeclarator(
          baseType(n.specifiers, this),
          x.declarator,
          this
        );
        const storage = n.specifiers?.find(
          (s) => s.type === "StorageClassSpecifier"
        )?.value;
        let cell;
        if (storage === "static") {
          const k = (this.currentFunctionName || "<global>") + ":" + name;
          if (!this.staticCells.has(k))
            this.staticCells.set(
              k,
              this.allocateObject(t, undefined, { static: true })
            );
          cell = this.staticCells.get(k);
        } else cell = this.allocateObject(t);
        if (x.initializer) this.initialize(cell, x.initializer, env);
        if (t.kind === "array") cell.__arrayCell = true;
        if (isAgg(t)) cell.__aggregateCell = true;
        env.define(name, cell);
      }
    }
    inferType(n, env) {
      if (!n) return C.int;
      if (n.type === "Identifier") {
        const c = env.lookup(n.name);
        if (c) return c.type;
        if (this.enums.has(n.name)) return C.int;
        if (this.functions.has(n.name)) {
          const d = this.functions.get(n.name);
          return { kind: "function", returnType: baseType(d.specifiers, this) };
        }
      }
      if (n.type === "NumericLiteral") return n.isFloat ? C.double : C.int;
      if (n.type === "CharacterLiteral") return C.int;
      if (n.type === "StringLiteral")
        return { kind: "pointer", to: C.char, size: 4, align: 4 };
      if (n.type === "ArraySubscriptExpression") {
        const t = this.inferType(n.object, env);
        return t?.kind === "array"
          ? t.of
          : t?.kind === "pointer"
          ? t.to
          : C.int;
      }
      if (n.type === "MemberExpression") {
        let t = this.inferType(n.object, env);
        if (n.throughPointer && t?.kind === "pointer") t = t.to;
        return t?.fields?.get(n.member)?.type || C.int;
      }
      if (n.type === "UnaryExpression") {
        if (n.operator === "&")
          return {
            kind: "pointer",
            to: this.inferType(n.argument, env),
            size: 4,
            align: 4,
          };
        if (n.operator === "*") {
          const t = this.inferType(n.argument, env);
          return t?.to || C.int;
        }
        if (n.operator === "sizeof") return C.unsigned_int;
        return promote(this.inferType(n.argument, env));
      }
      if (n.type === "BinaryExpression")
        return binaryType(
          this.inferType(n.left, env),
          this.inferType(n.right, env),
          n.operator
        );
      if (n.type === "AssignmentExpression") return this.inferType(n.left, env);
      if (n.type === "CastExpression")
        return this.typeFromTypeName(n.targetType);
      if (n.type === "ConditionalExpression")
        return binaryType(
          this.inferType(n.thenExpression, env),
          this.inferType(n.elseExpression, env),
          "?:"
        );
      return C.int;
    }
    sizeofExpr(n, env) {
      if (n.type === "ParenthesizedExpression")
        return this.sizeofExpr(n.expression, env);
      if (n.type === "Identifier") {
        const c = env.lookup(n.name);
        if (c) return this.sizeofType(c.type);
      }
      if (n.type === "StringLiteral")
        return (n.parts || []).map(decodeCString).join("").length + 1;
      return this.sizeofType(this.inferType(n, env));
    }
    evalJS(n, env) {
      const args = (n.arguments || []).map((a) => this.eval(a, env));
      if (!args.length) return undefined;
      return global.BrowCRuntime.evaluateJS(args[0]);
    }
    run(options = {}) {
      const argv = Array.isArray(options.argv) ? options.argv : [];
      const main = this.functions.get("main");
      if (!main) throw new Error("BrowC program has no main()");
      const fd = this.findFunctionDeclarator(main.declarator);
      const params = fd?.parameters || [];
      let args = [];
      if (params.length) {
        const argc = argv.length;
        const av = global.BrowCRuntime.malloc((argv.length + 1) * 4);
        const strings = [];
        for (let i = 0; i < argv.length; i++) {
          const p = global.BrowCRuntime.strdup(argv[i]);
          strings.push(p);
          global.BrowCRuntime.store32(av.add(i * 4), p.address);
        }
        global.BrowCRuntime.store32(av.add(argv.length * 4), 0);
        args = [argc, av];
      }
      try {
        return this.callFunction(main, args, "main");
      } catch (e) {
        if (e instanceof CExit) return e.code;
        throw e;
      }
    }
  }
  class CReturn extends Error {
    constructor(value) {
      super();
      this.value = value;
    }
  }
  class CBreak extends Error {}
  class CContinue extends Error {}
  class CGoto extends Error {
    constructor(label) {
      super();
      this.label = label;
    }
  }
  class CExit extends Error {
    constructor(code) {
      super();
      this.code = code;
    }
  }
  function isPointerValue(v) {
    return !!v && v.__browc_pointer === true;
  }
  function parseCNumber(s) {
    s = String(s).replace(/'/g, "");
    const clean = s.replace(/([uUlLfF]+)$/, "");
    if (
      /^0[xX][0-9a-fA-F]+[pP][+-]?\d+/.test(clean) ||
      /^0[xX][0-9a-fA-F]*\.[0-9a-fA-F]+[pP][+-]?\d+/.test(clean)
    ) {
      const m = clean.match(
        /^0[xX]([0-9a-fA-F]*(?:\.[0-9a-fA-F]*)?)[pP]([+-]?\d+)$/
      );
      if (m) {
        let [ip, fp = ""] = m[1].split(".");
        let mant = BigInt("0x" + (ip || "0") + fp);
        let e = Number(m[2]) - 4 * fp.length;
        return Number(mant) * 2 ** e;
      }
    }
    if (/^0[0-7]+$/.test(clean) && clean.length > 1)
      return Number.parseInt(clean, 8);
    if (/^0[xX][0-9a-fA-F]+$/.test(clean)) return Number.parseInt(clean, 16);
    if (/^[0-9]+$/.test(clean)) return Number(clean);
    return Number(clean);
  }
  function decodeCChar(raw) {
    const s = decodeCString(String(raw));
    if (s.length === 0) return 0;
    if (s.length === 1) return s.charCodeAt(0);
    let v = 0;
    for (const c of s) v = (v << 8) | c.charCodeAt(0);
    return v;
  }
  function decodeCString(raw) {
    let s = String(raw);
    if (s[0] === '"' || s[0] === "'") s = s.slice(1, -1);
    return s
      .replace(/\\x([0-9A-Fa-f]+)/g, (_, h) =>
        String.fromCodePoint(parseInt(h, 16))
      )
      .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) =>
        String.fromCodePoint(parseInt(h, 16))
      )
      .replace(/\\U([0-9A-Fa-f]{8})/g, (_, h) =>
        String.fromCodePoint(parseInt(h, 16))
      )
      .replace(/\\a/g, "\x07")
      .replace(/\\b/g, "\b")
      .replace(/\\f/g, "\f")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\v/g, "\v")
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\?/g, "?");
  }

  /* Runtime hardening independent of the interpreter. */
  if (global.BrowCPointer && !global.BrowCPointer.prototype.__c99StridePatch) {
    const P = global.BrowCPointer.prototype;
    P.add = function (amount) {
      const stride =
        this.pointee && this.pointee.__size
          ? this.pointee.__size
          : (this.pointee && this.pointee.size) || 1;
      return new global.BrowCPointer(
        this.runtime,
        this.block,
        this.offset + toSafeInt(amount) * stride,
        this.pointee
      );
    };
    P.difference = function (other) {
      if (!global.browcIsPointer?.(other) && !(other && other.__browc_pointer))
        throw new Error("pointer subtraction requires pointer");
      if (this.block !== other.block)
        throw new Error("pointers must point into the same array object");
      const stride = (this.pointee && this.pointee.size) || 1;
      if (this.offset % stride || other.offset % stride)
        throw new Error("misaligned pointer subtraction");
      return (this.offset - other.offset) / stride;
    };
    P.__c99StridePatch = true;
  }

  /* Exit must be non-local control flow, not a normal return. */
  const oldExit = global.BrowCRuntime.exit.bind(global.BrowCRuntime);
  global.BrowCRuntime.exit = function (code = 0) {
    throw new CExit(toSafeInt(code));
  };
  global.BrowCRuntime.runMain = function (main, options = {}) {
    if (typeof main !== "function") throw new Error("no main");
    try {
      return main(...(options.argv || []));
    } catch (e) {
      if (e instanceof CExit) {
        this.exitCode = e.code;
        return e.code;
      }
      throw e;
    }
  };

  /* C byte-string and formatted-I/O corrections. */
  rt.strlen = function (v) {
    if (v && v.__browc_pointer) {
      let i = 0;
      while (v.add(i).readUint8() !== 0) i++;
      return i;
    }
    return new TextEncoder().encode(this.toCString(v)).length;
  };
  rt.strncmp = function (a, b, n) {
    const aa = bytesOf(a),
      bb = bytesOf(b),
      m = Math.max(0, toSafeInt(n));
    for (let i = 0; i < m; i++) {
      const x = aa[i] ?? 0,
        y = bb[i] ?? 0;
      if (x !== y) return x < y ? -1 : 1;
      if (x === 0) break;
    }
    return 0;
  };
  rt.strcmp = function (a, b) {
    return rt.strncmp(a, b, Math.max(bytesOf(a).length, bytesOf(b).length) + 1);
  };
  rt.strncpy = function (dst, src, n) {
    dst = rt.memory.requirePointer(dst);
    const b = bytesOf(src),
      m = Math.max(0, toSafeInt(n));
    dst.checkRange(m);
    for (let i = 0; i < m; i++) dst.add(i).writeUint8(i < b.length ? b[i] : 0);
    return dst;
  };
  rt.strncat = function (dst, src, n) {
    dst = rt.memory.requirePointer(dst);
    const base = dst.readCString(),
      addBytes = bytesOf(src).slice(0, Math.max(0, toSafeInt(n)));
    const old = new TextEncoder().encode(base);
    dst.checkRange(old.length + addBytes.length + 1);
    for (let i = 0; i < addBytes.length; i++)
      dst.add(old.length + i).writeUint8(addBytes[i]);
    dst.add(old.length + addBytes.length).writeUint8(0);
    return dst;
  };
  rt.strstr = function (hay, needle) {
    if (hay && hay.__browc_pointer) {
      const h = hay.readCString(),
        n = this.toCString(needle),
        i = h.indexOf(n);
      return i < 0
        ? null
        : hay.add(new TextEncoder().encode(h.slice(0, i)).length);
    }
    const h = this.toCString(hay),
      n = this.toCString(needle),
      i = h.indexOf(n);
    return i < 0 ? null : h.slice(i);
  };
  rt.strrchr = function (v, ch) {
    const target = toSafeInt(ch) & 255;
    if (v && v.__browc_pointer) {
      for (let i = 0; ; i++) {
        const x = v.add(i).readUint8();
        if (x === target) return v.add(i);
        if (x === 0) return null;
      }
    }
    const s = this.toCString(v),
      c = String.fromCharCode(target),
      i = s.lastIndexOf(c);
    return i < 0 ? null : s.slice(i);
  };
  rt.strpbrk = function (v, a) {
    const set = new Set(
      [...this.toCString(a)].map((x) => x.charCodeAt(0) & 255)
    );
    if (v && v.__browc_pointer) {
      for (let i = 0; ; i++) {
        const x = v.add(i).readUint8();
        if (set.has(x)) return v.add(i);
        if (x === 0) return null;
      }
    }
    const s = this.toCString(v);
    for (let i = 0; i < s.length; i++)
      if (set.has(s.charCodeAt(i) & 255)) return s.slice(i);
    return null;
  };
  function bytesOf(v) {
    if (v && v.__browc_pointer) {
      const a = [];
      for (let i = 0; ; i++) {
        const x = v.add(i).readUint8();
        if (x === 0) break;
        a.push(x);
      }
      return Uint8Array.from(a);
    }
    return new TextEncoder().encode(rt.toCString(v));
  }
  rt.format = function (format, args) {
    format = String(format);
    let out = "",
      ai = 0;
    const re =
      /%(%|[-+ #0]*\d*(?:\.\d+)?(?:hh|h|ll|l|j|z|t|L)?[diouxXfFeEgGaAcspn])/g;
    let last = 0,
      m;
    while ((m = re.exec(format))) {
      out += format.slice(last, m.index);
      last = re.lastIndex;
      const spec = m[1];
      if (spec === "%") {
        out += "%";
        continue;
      }
      const conv = spec[spec.length - 1];
      const arg = args[ai++];
      const len =
        spec.match(/(hh|ll|h|l|j|z|t|L)(?=[diouxXfFeEgGaAcspn]$)/)?.[1] || "";
      if (conv === "n") {
        if (arg && arg.__browc_pointer) {
          const count = out.length;
          if (len === "hh") rt.store8(arg, count);
          else if (len === "h") rt.store16(arg, count);
          else rt.store32(arg, count);
        }
        continue;
      }
      if (conv === "s") {
        out += arg == null ? "(null)" : rt.toCString(arg);
        continue;
      }
      if (conv === "c") {
        out += String.fromCharCode(toSafeInt(arg) & 0xff);
        continue;
      }
      if (conv === "p") {
        out +=
          arg && arg.__browc_pointer ? "0x" + arg.address.toString(16) : "0x0";
        continue;
      }
      let precision = (spec.match(/\.(\d+)/) || [])[1];
      precision = precision == null ? undefined : Number(precision);
      let flags = spec.match(/^[-+ #0]*/)?.[0] || "",
        width = Number((spec.match(/[0-9]+/) || [])[0] || 0),
        v = arg;
      if ("diouxX".includes(conv)) {
        let n = typeof v === "bigint" ? v : BigInt(Math.trunc(Number(v) || 0));
        if (conv === "d" || conv === "i") {
          let signed =
            len === "hh"
              ? 8
              : len === "h"
              ? 16
              : len === "l" || len === "ll" || len === "j" || len === "t"
              ? 64
              : 32;
          let mod = 1n << BigInt(signed);
          n = ((n % mod) + mod) % mod;
          if (n >= 1n << BigInt(signed - 1)) n -= mod;
          out += n.toString(10);
        } else {
          let bits =
            len === "hh"
              ? 8
              : len === "h"
              ? 16
              : len === "l" ||
                len === "ll" ||
                len === "j" ||
                len === "z" ||
                len === "t"
              ? 64
              : 32;
          n =
            ((n % (1n << BigInt(bits))) + (1n << BigInt(bits))) %
            (1n << BigInt(bits));
          out += n.toString(
            conv === "o" ? 8 : conv === "x" || conv === "X" ? 16 : 10
          );
          if (conv === "X")
            out =
              out.slice(0, -out.match(/[^0-9A-F]*$/)?.[0]?.length || 0) +
              out.slice(-1);
        }
      } else if ("fFeEgGaA".includes(conv)) {
        let num = Number(v);
        if (conv === "f" || conv === "F") out += num.toFixed(precision ?? 6);
        else if (conv === "e" || conv === "E")
          out += num.toExponential(precision ?? 6);
        else if (conv === "g" || conv === "G") {
          let z = num.toPrecision(precision ?? 6);
          if (z.includes("e") || z.includes("E")) {
            z = z
              .replace(/(\d+\.\d*?)(0+)([eE])/, "$1$3")
              .replace(/\.([eE])/, "$1");
          } else {
            z = z.replace(/\.(\d*?)0+$/, ".$1").replace(/\.$/, "");
          }
          out += z;
        } else if (conv === "a" || conv === "A") {
          if (num === 0) out += "0x0p+0";
          else {
            const sign = num < 0 ? "-" : "";
            num = Math.abs(num);
            let e = Math.floor(Math.log2(num)),
              mant = num / 2 ** e;
            out +=
              sign +
              "0x" +
              mant.toString(16) +
              (conv === "A" ? "P" : "p") +
              (e >= 0 ? "+" : "") +
              e;
          }
        }
      } else out += String(v);
      if (width && out.length < m.index + width) {
        const piece = out.slice(m.index);
        out = out.slice(0, m.index) + piece.padStart(width, " ");
      }
    }
    out += format.slice(last);
    return out;
  };
  global.strrchr = rt.strrchr.bind(rt);
  global.strpbrk = rt.strpbrk.bind(rt);

  /* Make native implementations discoverable without relying on JS globals. */
  if (!global.__BROWC_IMPL__) {
    global.__BROWC_IMPL__ = Object.create(null);
  }
  if (typeof global.BrowCNativeFunctions === "object")
    Object.assign(global.__BROWC_IMPL__, global.BrowCNativeFunctions);

  global.BrowCC99Interpreter = BrowCC99Interpreter;
  global.runBrowCSource = function (
    cSource,
    filename = "<script>",
    options = {}
  ) {
    const pp = new global.BrowCPreprocessor({
      standardLibrary: typeof HEADERS !== "undefined" ? HEADERS : {},
      filename,
    });
    const pre = pp.preprocess(cSource, filename);
    const code = typeof pre === "string" ? pre : pre.code;
    const ast = global.parseBrowC(code, { filename });
    const interp = new BrowCC99Interpreter(ast, options);
    return interp.run({ argv: options.argv || [] });
  };
  global.__BROWC_C99_SEMANTIC_LAYER__ = {
    version: "2.0.0",
    mode: "C99-semantic-interpreter",
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
