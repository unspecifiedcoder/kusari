# Build and run the judge app

Use Node.js 24 LTS. The repository pins `24.22.2` in `.nvmrc`, and the app declares `24.x` for hosted builds. Node 22.10 cannot load the Tailwind dependency graph used by this app.

With a Node version manager, install and select the pinned version before running these commands:

```sh
cd app
npm ci
npm run build
npm run start
```

For development, use `npm run dev` instead of build/start. Development listens on port 3001; production `npm run start` uses Next's default port 3000, or the `PORT` environment variable.

The prebuild/predev script copies the checked-in deployment and shared types into generated app files. Build from a checkout containing the whole repository: `shared/`, `deployments/`, and `config/` must remain alongside `app/`. For a Vercel project rooted in `app`, include files outside the root directory.

The app uses local system fonts, so building does not need access to Google Fonts. Private wallet or model keys are not required to compile the frontend. Runtime demo services have their own configuration; never place private keys in `NEXT_PUBLIC_*` variables.

To check the frontend after changes:

```sh
npm run lint
npm run build
```

Keep the Node version consistent between the build machine and host. Do not change dependency versions to work around an unsupported Node runtime.
