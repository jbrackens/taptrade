import React, { useState } from 'react';
import { cx } from '../utils/classNames';
import Input from './Input';

interface HeaderNavItem {
  label: string;
  active?: boolean;
  onClick?: () => void;
}

interface HeaderProps {
  logo?: string;
  logoIcon?: string;
  navItems?: HeaderNavItem[];
  onSearch?: (query: string) => void;
  onUserMenuClick?: (action: string) => void;
  userName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  logo = 'Tap Trade UI',
  logoIcon = '🏀',
  navItems = [],
  onSearch,
  onUserMenuClick,
  userName = 'User',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    onSearch?.(query);
  };

  const handleUserMenuAction = (action: string) => {
    onUserMenuClick?.(action);
    setUserMenuOpen(false);
  };

  return (
    <header className="flex items-center justify-between gap-6 border-b border-[#3d3d5c] bg-[#2d2d44] px-6 py-4">
      <div className="flex items-center gap-4 text-[28px] font-bold leading-[36px] text-white">
        <span className="text-[28px]">{logoIcon}</span>
        <span>{logo}</span>
      </div>

      <nav className="ml-8 flex flex-1 gap-6 max-[899px]:hidden">
        {navItems.map((item, index) => (
          <a
            key={index}
            className={cx(
              'cursor-pointer font-medium no-underline transition-colors duration-200 ease-in-out hover:text-white',
              item.active ? 'text-[#2196f3]' : 'text-[#9a9aad]'
            )}
            onClick={item.onClick}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="relative max-w-[400px] flex-1">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[18px] text-[#9a9aad]">
          🔍
        </span>
        <Input
          type="text"
          className="!pl-10"
          placeholder="Search..."
          value={searchQuery}
          onChange={handleSearch}
        />
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <button
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-2xl text-white transition-all duration-200 ease-in-out hover:bg-[#4a4a5e]"
            aria-label={`${userName} menu`}
            onClick={() => setUserMenuOpen(!userMenuOpen)}
          >
            👤
          </button>
          <div
            className={cx(
              'absolute right-0 top-full z-[100] mt-2 min-w-[200px] rounded-[12px] border border-[#3d3d5c] bg-[#2d2d44] shadow-[0_4px_12px_rgba(0,0,0,0.3)]',
              userMenuOpen ? 'block' : 'hidden'
            )}
          >
            <a
              className="block cursor-pointer border-b border-[#3d3d5c] px-4 py-2 text-white no-underline transition-all duration-200 ease-in-out hover:bg-[#4a4a5e]"
              onClick={() => handleUserMenuAction('profile')}
            >
              Profile
            </a>
            <a
              className="block cursor-pointer border-b border-[#3d3d5c] px-4 py-2 text-white no-underline transition-all duration-200 ease-in-out hover:bg-[#4a4a5e]"
              onClick={() => handleUserMenuAction('settings')}
            >
              Settings
            </a>
            <a
              className="block cursor-pointer px-4 py-2 text-white no-underline transition-all duration-200 ease-in-out hover:bg-[#4a4a5e]"
              onClick={() => handleUserMenuAction('logout')}
            >
              Logout
            </a>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
