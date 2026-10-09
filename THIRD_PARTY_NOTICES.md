# Third-party notices

Git Native UI's original code is covered by [LICENSE.txt](LICENSE.txt). Copied code, bundled libraries, and icon assets retain their own copyrights and licenses.

## Bundled libraries

The build copies complete dependency license texts and copyright notices into `dist/UI_LICENSES.txt`, which is included in the VSIX. Versions and integrity hashes are recorded in `package-lock.json`.

- MIT: React, React DOM, scheduler, the React compiler runtime, TanStack Virtual, Floating UI, tabbable, clsx, Zustand, VSCode Elements, jsonc-parser, and picomatch.
- BSD-3-Clause: Lit, Lit Element, Lit HTML, Lit Reactive Element, and Lit Context.

VSCode Elements is a community project. File theme icons and fonts are supplied by the installed VS Code theme extension.

## Codicons

[Codicons](https://github.com/microsoft/vscode-codicons) is provided by Microsoft Corporation. The icons and bundled, unmodified `codicon.ttf` font use [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Code, including the bundled stylesheet, uses the [MIT license](https://github.com/microsoft/vscode-codicons/blob/main/LICENSE-CODE).

Both complete license texts are included in `dist/UI_LICENSES.txt`.

## Git logo

The icons in `assets/git-native-ui.svg` and `assets/marketplace-icon.png` are adapted from Git Logo by Jason Long, available from [Git's logo downloads](https://git-scm.com/community/logos), under [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).

The Marketplace icon uses a navy diamond and white branch symbol. The panel icon uses the current VS Code theme color. Git and the Git logo are trademarks of Software Freedom Conservancy, Inc.

## Copied VS Code code

The portable Git graph, graph test assertions, and public Git API structural declarations derive from [Microsoft Visual Studio Code](https://github.com/microsoft/vscode) under the MIT license below. Source paths, hashes, adaptations, and adopted revisions are recorded in [the source manifest](upstream/vscode/manifest.json).

MIT License

Copyright (c) 2015 - present Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
