import React from 'react';

const Layout = ({ children }) => {
    return (
        <div>
            <header>
                <h1>BizReminder</h1>
            </header>
            <main>{children}</main>
            <footer>
                <p>&copy; {new Date().getFullYear()} BizReminder. All rights reserved.</p>
            </footer>
        </div>
    );
};

export default Layout;