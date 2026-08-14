import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function NavBar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    async function handleLogout() {
        await logout();
        navigate('/');
    }

    return (
        <nav className="navbar">
            <Link to="/" className="navbar__brand">
                <img src="/art/gui/Logo-Bubble.png" alt="Campus Trade" className="navbar__logo" />
            </Link>
            <Link to="/" className="navbar__link">Home</Link>
            <Link to="/collection" className="navbar__link">Collection</Link>
            <Link to="/rules" className="navbar__link">Rules &amp; FAQ</Link>

            {user ? (
                <>
                    {user.isAdmin && <Link to="/admin" className="navbar__link">Admin</Link>}
                    <Link to="/account" className="navbar__link">{user.username}</Link>
                    <button type="button" className="navbar__link navbar__button" onClick={handleLogout}>
                        Log out
                    </button>
                </>
            ) : (
                <>
                    <Link to="/login" className="navbar__link">Log in</Link>
                    <Link to="/register" className="navbar__link">Register</Link>
                </>
            )}
        </nav>
    );
}
