/** A CSS Module's default export: its local class names, mapped to the scoped names the bundler emits. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

/** A plain stylesheet, imported for its side effect. */
declare module '*.css';
