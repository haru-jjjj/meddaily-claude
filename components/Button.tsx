import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  fullWidth = false, 
  className = '', 
  ...props 
}) => {
  const baseStyle = "px-6 py-3 rounded-lg font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2";
  
  const variants = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200",
    secondary: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-200",
    outline: "border-2 border-slate-200 hover:border-blue-400 text-slate-600 hover:text-blue-600 bg-white"
  };

  const widthClass = fullWidth ? 'w-full' : '';

  return (
    <button 
      className={`${baseStyle} ${variants[variant]} ${widthClass} ${className}`} 
      {...props}
    >
      {children}
    </button>
  );
};