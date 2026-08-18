import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import QrScannerModal from './QrScannerModal';

export default function NavBar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [menuOpen, setMenuOpen] = useState(false);
    const [scannerOpen, setScannerOpen] = useState(false);

    // Close the mobile menu whenever the route changes, so it doesn't stay open after
    // following a link.
    useEffect(() => setMenuOpen(false), [location.pathname]);

    async function handleLogout() {
        await logout();
        navigate('/');
    }

    return (
        <nav className="navbar">
            <Link to="/" className="navbar__brand">
                <img src="/art/gui/Logo-Bubble.png" alt="Campus Trade" className="navbar__logo" />
            </Link>

            <button
                type="button"
                className="navbar__scan-button"
                onClick={() => setScannerOpen(true)}
                aria-label="Scan a card"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="navbar__scan-icon"
                    aria-hidden="true"
                >
                    <path d="M4 8V5a1 1 0 0 1 1-1h3" />
                    <path d="M17 4h3a1 1 0 0 1 1 1v3" />
                    <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
                    <path d="M7 20H4a1 1 0 0 1-1-1v-3" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                </svg>
                <span className="navbar__scan-label">Scan</span>
            </button>

            <button
                type="button"
                className="navbar__hamburger"
                aria-label="Menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="navbar__hamburger-icon"
                    aria-hidden="true"
                >
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
            </button>

            <div className={`navbar__links${menuOpen ? ' navbar__links--open' : ''}`}>
                <Link to="/" className="navbar__link">
                    Home
                </Link>
                <Link to="/collection" className="navbar__link">
                    Collection
                </Link>
                <Link to="/rules" className="navbar__link">
                    Rules &amp; FAQ
                </Link>

                {user ? (
                    <>
                        {user.isAdmin && (
                            <Link to="/admin" className="navbar__link">
                                Admin
                            </Link>
                        )}
                        <Link to="/account" className="navbar__link">
                            {user.username}
                        </Link>
                        <button type="button" className="navbar__link navbar__button" onClick={handleLogout}>
                            Log out
                        </button>
                    </>
                ) : (
                    <>
                        <Link to="/login" className="navbar__link">
                            Log in
                        </Link>
                        <Link to="/register" className="navbar__link">
                            Register
                        </Link>
                    </>
                )}
            </div>

            {scannerOpen && <QrScannerModal onClose={() => setScannerOpen(false)} />}
        </nav>
    );
}
