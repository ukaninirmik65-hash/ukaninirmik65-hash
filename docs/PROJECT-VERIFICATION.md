# Project verification

Checked **5 November 2026**. All nine public repositories were discovered through GitHub and inspected through their trees, README files, manifests where present, and representative source files. Six were selected for breadth of frontend work, implemented functionality, documentation, and working demonstrations. HTTP checks confirm reachability, not a complete browser interaction audit.

| Project and repository | Verified stack and implemented scope | Evidence in that repository | Verified demo |
| --- | --- | --- | --- |
| [ERP Management Frontend](https://github.com/ukaninirmik65-hash/ERP-App) | React, JavaScript, CSS, Vite, Material UI and Recharts; customer CRUD/search/filtering, inventory views and charts. Uses local/static data; some modules remain Coming Soon. | `package.json`, `README.md`, `src/components/pages/Crm.jsx`, `src/components/pages/Inventory.jsx`, `src/components/Deshbord.jsx` | [ERP demo](https://erp-app-khaki.vercel.app) — HTTP 200 |
| [Atal Kriya 2.0](https://github.com/ukaninirmik65-hash/atakKriya-2.O) | React, JavaScript, Tailwind CSS, Vite, React Router and Leaflet; employee dashboard, attendance, leave requests, expenses and map-based workflows. Frontend prototype with mock login/localStorage. | `package.json`, `src/components/context/AuthProvider.jsx`, `src/hook/useEmployeeDashboardData.js`, `src/pages/dashboard/LeaveRequests.jsx`, `src/pages/dashboard/SalesRouteMap.jsx` | [Atal demo](https://atak-kriya-2-o.vercel.app/) — HTTP 200 |
| [Tetris Game](https://github.com/ukaninirmik65-hash/Tetris-Game) | HTML, CSS, JavaScript and Canvas API; movement/rotation, collisions, line clearing, next-piece preview, audio and browser-local high scores. | `index.html`, `script.js`, `style.css` | [GitHub Pages demo](https://ukaninirmik65-hash.github.io/Tetris-Game/) — HTML, JavaScript and CSS all HTTP 200 |
| [Anita Jewellery](https://github.com/ukaninirmik65-hash/Anitajewellerys) | HTML, CSS and JavaScript; promotional hero, product and collection showcases, responsive styling and mobile navigation. Frontend showcase; checkout/payments are not implemented. | `README.md`, `index.html`, `css/responsive.css`, `js/script.js` | [Anita demo](https://anitajewellerys-k56t.vercel.app/) — HTTP 200 |
| [Neelmadhav Public School](https://github.com/ukaninirmik65-hash/Neelmadhav-Public-School) | HTML, CSS and JavaScript; responsive navigation, academic sections, scroll reveal, gallery and reduced-motion handling. Some school content and imagery are placeholders; no client relationship is inferred. | `index.html`, `script.js`, `style.css` | [School demo](https://neelmadhav-public-school.vercel.app) — HTTP 200 |
| [Personal Portfolio](https://github.com/ukaninirmik65-hash/nirmik-portfolio) | React, JavaScript, Tailwind CSS and Vite; dark/light theme, project presentation, frontend services and a validated inquiry flow. | `README.md`, `package.json`, `src/data/portfolio.js`, `src/components/InquiryForm.jsx`, `src/hooks/useTheme.js` | [Portfolio](https://nirmik-portfolio.vercel.app/) — HTML and deployed JavaScript HTTP 200 |

## Corrections and selection decisions

- The old Tetris Vercel homepage returned HTTP 404. The working GitHub Pages deployment is used instead.
- Anita's repository homepage without `-k56t` returned HTTP 404. Its README supplied the working `-k56t` deployment.
- “Atal Kriya 2.0” follows the repository and portfolio naming; the pasted “ATAL KATIYA” was inconsistent with these sources.
- `motiwalaperfumes-clone` is a legitimate HTML/CSS/JavaScript practice recreation with a slider and product grid. It was inspected but excluded to keep the featured selection focused on six projects. Preserve its practice-clone attribution if adding it later.
- `demo` is a React/TypeScript marketing interface whose README credits a Figma design source. Its configured Vercel homepage returned HTTP 404. It was excluded from the featured six; business results and testimonials in demonstration content are not developer achievements.
- The profile repository itself is included in public repository totals but is not a featured project.
- The portfolio default branch is `codex/portfolio`; repository links do not assume `main`.

## Contact and reference checks

- The GitHub profile/repositories, portfolio, reference GitHub profile and Freelancer profile were reachable. Freelancer returned HTTP 200 with the title “Ukani Profile | Freelancer.”
- LinkedIn returned **HTTP 999**, an automated-access restriction. The exact owner-supplied LinkedIn URL is preserved; its page content requires a manual browser check.
- The reference profile informed only broad hierarchy and restraint. Its content and assets were not copied.
- No activity screenshot accompanied the available text attachment. The dashboard follows the written layout specification.

Experience and primary skill claims follow the owner's brief. Project cards describe frontend implementation and do not imply backend systems, employment history, paying clients, secure production authentication, or transaction processing.
