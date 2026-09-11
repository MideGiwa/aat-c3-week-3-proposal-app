# Week 3: AI Proposal / Document Application

This folder contains the Week 3 project brief and the reference assets for the build.

## Files

- `PRD.md`: the project brief
- `assets/intake-form-fields.md`: the intake fields from the proposal request form
- `assets/proposal-template.md`: the proposal structure students can adapt
- `assets/client-email-template.md`: the client email structure students can adapt
- `architecture.md`: the application architecture, broken into core components with technical requirements per component
- `implementation-plan.md`: the phased task breakdown built from the architecture
- `app/`: the Next.js application itself (see `app/README.md` for setup and current status)

Start with `PRD.md`, then use the files in `assets/` as reference material for the application.

## Current status

Phases 0–4 of `implementation-plan.md` are implemented in `app/`: project setup, intake, AI generation (Claude drafts each section, flags missing information instead of guessing), section editing and regeneration, and the internal approval workflow. Phases 5–8 (PDF export, email delivery, a dedicated failure-mode testing pass, and the submission deliverables) are next — see `implementation-plan.md` for the breakdown and `app/README.md` for what's built versus what's a known, tracked gap.
