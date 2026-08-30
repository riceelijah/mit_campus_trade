import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { FlagColor } from '../types';
import { isValidMitEmail, isValidPassword } from '../validation';
import { capitalize } from '../lib/format';

const TEAM_COLORS: FlagColor[] = [
    'red',
    'blue',
    'green',
    'yellow',
    'orange',
    'purple',
    'pink',
    'black',
    'white',
    'brown',
    'gold',
    'silver',
];

export default function RegisterPage() {
    const { register } = useAuth();
    const navigate = useNavigate();

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [team, setTeam] = useState<FlagColor | ''>('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError(null);

        if (!name.trim()) {
            setError('Name is required');
            return;
        }
        if (!isValidMitEmail(email)) {
            setError('Email must be a valid @mit.edu address');
            return;
        }
        if (!team) {
            setError('Please choose a team color');
            return;
        }
        if (!isValidPassword(password)) {
            setError('Password must be at least 8 characters');
            return;
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setSubmitting(true);
        try {
            await register({ name, email, team, password, confirmPassword });
            navigate('/');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="auth-page">
            <h1>Create an account</h1>
            <form className="auth-form" onSubmit={handleSubmit}>
                <label>
                    Name
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your real or preferred name"
                    />
                    <span className="auth-form__hint">
                        Please use your real or preferred name &mdash; it&rsquo;s what other students will see
                        when trading with you.
                    </span>
                </label>
                <label>
                    Email
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@mit.edu"
                    />
                    <span className="auth-form__hint">
                        Please use the same @mit.edu email you used for the pre-survey, if you took it.
                    </span>
                </label>
                <label>
                    Team color
                    <select value={team} onChange={(e) => setTeam(e.target.value as FlagColor)}>
                        <option value="" disabled>
                            Choose a team&hellip;
                        </option>
                        {TEAM_COLORS.map((color) => (
                            <option key={color} value={color}>
                                {capitalize(color)}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Password
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
                <label>
                    Confirm password
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                </label>

                {error && <p className="form-error">{error}</p>}

                <button type="submit" disabled={submitting}>
                    {submitting ? 'Creating account…' : 'Create account'}
                </button>
            </form>
            <p>
                Already have an account? <Link to="/login">Log in</Link>
            </p>
        </div>
    );
}
