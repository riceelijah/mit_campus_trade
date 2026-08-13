import { Link } from 'react-router-dom';

export default function NavBar() {
    return (
        <nav className="navbar">
            <Link to="/" className="navbar__brand">MIT Campus Trade</Link>
            <Link to="/" className="navbar__link">Home</Link>
            <Link to="/collection" className="navbar__link">Collection</Link>
            <Link to="/rules" className="navbar__link">Rules &amp; FAQ</Link>
        </nav>
    );
}
