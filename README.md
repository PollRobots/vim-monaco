## vim-monaco

vim mode for use with the [Monaco Editor](https://microsoft.github.io/monaco-editor/)

[![npm version](https://badge.fury.io/js/vim-monaco.svg)](https://npmjs.com/package/vim-monaco)

**Note:** This package does not include the [monaco-editor](https://npmjs.org/package/monaco-editor). It requires that Monaco has already been loaded, and depends on `window.monaco` having been populated. See the `monaco-editor` readme for how to accomplish this.

### Basic Usage

At a _minimum_ you can simply

```typescript
import { VimMode } from 'vim-monaco';

.
.
.

// editor is a monaco.editor.IStandaloneCodeEditor
const vimMode = new VimMode(editor);
// enable vim mode.
vimMode.enable();
```

### Status Bar

It isn't particularly usable without a status bar, there is no mode indication, and no way to input commands.

The `VimMode` constructor has an optional second parameter `statusBar: IStatusBar`.

The `IStatusBar` type documentation describes how this needs to be implemented.

Alternatively, there is a simple DOM implementation of this that can be created
using `makeDomStatusBar` which takes two arguments. A parent DOM node (to which the status bar will append itself), and a callback function that will be used to pass the focus back to Monaco

```typescript
import { VimMode, makeDomStatusBar } from "vim-monaco";

// parent is an html element (likely the parent of the editor)
// editor is a monaco.editor.IStandaloneCodeEditor
const statusBar = makeDomStatusBar(parent, () => editor.focus());
const vimMode = new VimMode(editor, statusBar);
// enable vim mode.
vimMode.enable();
```

[jsfiddle example](https://jsfiddle.net/na4kLj0v/5/)

### File load and save

By default `:write`, `:edit` and `:save` don't do anything. You can enable this functionality by adding event listeners to the `vimMode` object for the `open-file` and `save-file` events.

The vim mode doesn't track the current filename, so these commands will only send any filename information passed in to the command.

Getting the current editor text for saving, and overwriting it for opening need to be handled directly with the IStandaloneCodeEditor instance.

```typescript
vimMode.addEventListener("open-file", () => {
  // code to open a file
});
vimMode.addEventListener("save-file", (evt) => {
  // the filename specified in a :save command (for example)
  const filename = evt.filename;
  const contents = editor.getValue();
  // code to save the file
});
```

### Clipboard

The `*` and `+` clipboard registers are not implemented by default. To enable interaction with the system clipboad you need to implement `IRegister` and add the two clipboard registers.

Because getting the contents of the clipboard is asynchronous, the vim mode raises a `clipboard` event whenever the keybuffer indicates that one of the clipboard registers is about to be accessed. This can be used to pre-fetch the cliboard contents.

```typescript
const clipboard = new ClipboardRegister(); // a class that implements IRegister
vimMode.setClipboardRegister(clipboard);
vimMode.addEventListener("clipboard", () => clipboard.update());
```

### Extras

- `vimMode.disable()` will disable the vim mode. This reverts the editor to its default inferior key bindings.
- `vimMode.executeCommand(cmd)` can be used to execute a command. For example `set iskeyword+=-` would add '-' to the set of keyword characters (used by `w` `*` etc.)
- `vimMode.setOption` can be used to set options. One use of this is to set the theme. The vim instance can use the ':colorscheme' command to get and set the theme, but while it can set the theme on the monaco editor instance, it cannot read the current theme name, so calling this on external theme changes will keep the value in sync.

## Acknowledgements

This was based on the [monaco-vim](https://github.com/brijeshb42/monaco-vim)
package by Brijesh Bittu.

Unfortunately that package didn't work for my needs, it depends on internal
features of an older version of monaco. So I ported to typescript and made some
different design decisions to allow me to avoid those dependencies.
