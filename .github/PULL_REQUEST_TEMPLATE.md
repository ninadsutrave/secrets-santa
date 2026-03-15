## Summary
<!-- What does this PR do, and why? Link to any related issue with "Fixes #123" or "Closes #123". -->

## Type of change
<!-- Check all that apply. -->
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / code quality
- [ ] Build / CI
- [ ] Documentation

## Changes
<!-- List the main files/areas changed and a one-line note on each. -->
-

## How to test
<!--
Step-by-step instructions for a reviewer to verify this PR manually.

Quick sideload reference:
  Chrome / Edge / Brave  →  chrome://extensions  → Developer mode ON → Load unpacked → dist/chromium
  Firefox                →  about:debugging      → This Firefox → Load Temporary Add-on → dist/firefox/manifest.json

To build locally: npm run build:all
-->
1. Build the extension: `npm run build:all`
2. Load it in your browser (see comment above)
3. Navigate to a Consul UI instance
4.

## CI checklist
<!-- These all run automatically — just confirm you've checked them locally first. -->
- [ ] `npm run lint` passes with no errors (`npm run lint:fix` auto-fixes safe issues)
- [ ] `npm run build:all` completes without errors
- [ ] Tested manually in at least one browser (Chrome, Firefox, Edge, or Brave)

## General checklist
- [ ] Follows existing code style and conventions in the file(s) changed
- [ ] Updates documentation / comments if behaviour changed
- [ ] Does not include secrets, tokens, or sensitive data
- [ ] Linked issue (if applicable): #
