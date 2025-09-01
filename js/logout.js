document.getElementById("logoutForm").addEventListener("submit", (e) => {
    e.preventDefault();
    localStorage.removeItem("token");
    window.location.href = `${SERVER_ENDPOINT}/auth_page.html`;
});
