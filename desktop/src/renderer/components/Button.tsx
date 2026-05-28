import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'danger' | 'ghost';
  icon?: ReactNode;
}

export function Button({ tone, icon, className = '', children, ...props }: ButtonProps) {
  const classes = ['button', tone, className].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} {...props}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}
