import React from 'react';
import { Toggle } from '../../atoms/Toggle/Toggle';
import styles from './ToggleField.module.css';

export interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
}

export const ToggleField: React.FC<ToggleFieldProps> = ({
  label, checked, onChange, description, disabled = false
}) => {
  return (
    <div>
      <div className={styles.field}>
        <span className={styles.label}>{label}</span>
        <Toggle checked={checked} onChange={onChange} disabled={disabled} aria-label={label} />
      </div>
      {description && <div className={styles.description}>{description}</div>}
    </div>
  );
};
