# OpenCam Website

The marketing, comparison, press, privacy, and terms website for
[OpenCam](https://opencam.app), an Open Gate video camera app for iPhone.

## Technology

- [Astro](https://astro.build) 7
- [Tailwind CSS](https://tailwindcss.com) 4
- GitHub Pages

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer

## Local development

```sh
npm install
npm run dev
```

The development server prints its local URL when it starts.

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Generate the production site in `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run astro -- --help` | Show Astro CLI help |

## Project structure

```text
src/
  components/   Reusable page sections and site-wide UI
  layouts/      Shared HTML layout and metadata
  pages/        Public routes
  styles/       Tailwind theme and global styles
public/         Images, icons, manifest, and domain configuration
```

Shared SEO and social metadata are defined in `src/components/BaseHead.astro`.
Each route supplies its own title and description through
`src/layouts/BaseLayout.astro`.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds and
publishes the site to GitHub Pages at [opencam.app](https://opencam.app).

Before changing the Privacy Policy or Terms and Conditions, review the legal
text and update its displayed revision date only when the policy itself changes.

## License

This repository is licensed under the [GPL-3.0 license](LICENSE).
