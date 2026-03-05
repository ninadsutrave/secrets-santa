export default [
    {
        ignores: ["dist/", "node_modules/", "scripts/"],
    },
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            parser: (await import("@typescript-eslint/parser")).default,
            globals: {
                window: "readonly",
                document: "readonly",
                chrome: "readonly",
                console: "readonly",
                URL: "readonly",
                fetch: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                globalThis: "readonly",
                sessionStorage: "readonly",
                localStorage: "readonly",
                CustomEvent: "readonly",
                location: "readonly",
                XMLHttpRequest: "readonly",
                Headers: "readonly",
                importScripts: "readonly",
                Promise: "readonly",
                Array: "readonly",
                Object: "readonly",
                String: "readonly",
                Number: "readonly",
                Boolean: "readonly",
                decodeURIComponent: "readonly",
                encodeURIComponent: "readonly",
                encodeURI: "readonly",
                JSON: "readonly",
                navigator: "readonly",
                crypto: "readonly",
                Blob: "readonly",
                TextDecoder: "readonly",
                atob: "readonly",
                requestAnimationFrame: "readonly",
                confirm: "readonly"
            },
        },
        plugins: {
            "@typescript-eslint": (await import("@typescript-eslint/eslint-plugin")).default
        },
        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["error", {
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_",
                "caughtErrorsIgnorePattern": "^_"
            }],
            "semi": ["error", "always"],
            "quotes": ["error", "double", { "avoidEscape": true }]
        },
    },
];
