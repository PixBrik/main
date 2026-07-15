import catalog from './catalog-demo.json';

export type Variant = (typeof catalog.variants)[number];
export type Part = (typeof catalog.parts)[number];
export type Country = (typeof catalog.countries)[number];
export type Store = (typeof catalog.stores)[number];
export type Instruction = (typeof catalog.instructions)[number];

export const demoProject = catalog.project;
export const variants = catalog.variants;
export const parts = catalog.parts;
export const countries = catalog.countries;
export const stores = catalog.stores;
export const instructions = catalog.instructions;
