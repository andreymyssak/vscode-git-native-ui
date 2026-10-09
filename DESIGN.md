# Git Native UI design

## Overview

Follow VS Code Source Control's visual style. Use VS Code theme variables and inherit its UI font and size.

Style webview components with CSS Modules. Apply module class names through `styles` and use `clsx` for conditional classes.

## Components

Use VSCode Elements and Codicons for webview controls. Reuse native VS Code menus, dialogs, notifications, pickers and diff editors through public APIs. Custom controls should match VS Code's focus, hover and selection styles.
