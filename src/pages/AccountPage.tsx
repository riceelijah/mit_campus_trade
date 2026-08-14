import { useState, FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isValidPassword } from '../validation';

export default function AccountPage() {
    const { user, loading, changePassword } = useAuth();

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    if (loading) {
        return null;
    }
    if (!user) {
        return <Navigate to="/login" replace />;
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError(null);
        setSuccess(false);

        if (!isValidPassword(newPassword)) {
            setError('New password must be at least 8 characters');
            return;
        }
        if (newPassword !== confirmNewPassword) {
            setError('New passwords do not match');
            return;
        }

        setSubmitting(true);
        try {
            await changePassword({ currentPassword, newPassword, confirmNewPassword });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmNewPassword('');
            setSuccess(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="auth-page">
            <h1>Account</h1>
            <p>
                Logged in as <strong>{user.username}</strong> ({user.email}), team {user.team}
                {user.isAdmin && ' — admin'}
            </p>

            <h2>Change password</h2>
            <form className="auth-form" onSubmit={handleSubmit}>
                <label>
                    Current password
                    <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                </label>
                <label>
                    New password
                    <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                    />
                </label>
                <label>
                    Confirm new password
                    <input
                        type="password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                    />
                </label>

                {error && <p className="form-error">{error}</p>}
                {success && <p className="form-success">Password changed.</p>}

                <button type="submit" disabled={submitting}>
                    {submitting ? 'Changing…' : 'Change password'}
                </button>
            </form>
        </div>
    );
}
