
  (function() {
    emailjs.init("YOUR_PUBLIC_KEY"); // Replace with your EmailJS public key
  })();
  
  // Initialize Stripe
  const stripe = Stripe('YOUR_STRIPE_PUBLISHABLE_KEY'); // Replace with your Stripe publishable key



let currentProduct = {};
let siteContent = null;

// Customer Account System
let currentUser = JSON.parse(localStorage.getItem('watenCurrentUser')) || null;

function openAccountModal() {
  document.getElementById('accountModal').style.display = 'flex';
  if (currentUser) {
    showAccountDashboard();
  } else {
    showLoginForm();
  }
}

function closeAccountModal() {
  document.getElementById('accountModal').style.display = 'none';
}

function showLoginForm() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('registerForm').style.display = 'none';
}

function showRegisterForm() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
}

function showAccountDashboard() {
  const modalContent = document.querySelector('#accountModal .modal-content');
  modalContent.innerHTML = `
    <span class="close" onclick="closeAccountModal()">Close</span>
    <h3>Welcome, ${currentUser.name}!</h3>
    <div style="text-align: left; margin-top: 2rem;">
      <p><strong>Email:</strong> ${currentUser.email}</p>
      <p><strong>Phone:</strong> ${currentUser.phone}</p>
      <p><strong>Member Since:</strong> ${new Date(currentUser.createdAt).toLocaleDateString()}</p>
    </div>
    
    <div style="margin-top: 2rem;">
      <h4>Quick Actions</h4>
      <div style="display: flex; gap: 1rem; margin-top: 1rem;">
        <button onclick="viewWishlist()" class="btn" style="flex: 1;">♡ My Wishlist (${wishlist.length})</button>
        <button onclick="viewMyReviews()" class="btn" style="flex: 1;">⭐ My Reviews</button>
      </div>
    </div>
    
    <div style="margin-top: 2rem;">
      <h4>Your Orders</h4>
      <div id="userOrders" style="margin-top: 1rem;">
        Loading your orders...
      </div>
    </div>
    <button onclick="logout()" class="btn confirm-order-btn" style="margin-top: 2rem;">Logout</button>
  `;
  
  loadUserOrders();
}

function viewMyReviews() {
  const reviews = JSON.parse(localStorage.getItem('watenReviews')) || {};
  const myReviews = [];
  
  // Find all reviews by this user
  Object.keys(reviews).forEach(productId => {
    reviews[productId].forEach(review => {
      if (review.userName === currentUser.name) {
        myReviews.push({ ...review, productId });
      }
    });
  });
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content">
      <span class="close" onclick="this.closest('.modal').remove()">Close</span>
      <h3>My Reviews (${myReviews.length})</h3>
      <div style="margin-top: 2rem;">
        ${myReviews.length === 0 ? 
          '<p style="color: var(--text-muted);">You haven\'t written any reviews yet.</p>' :
          myReviews.map(review => `
            <div style="padding: 1rem; border-bottom: 1px solid var(--border); margin-bottom: 1rem;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <span style="color: var(--accent);">Product ID: ${review.productId}</span>
                <span>${'⭐'.repeat(review.rating)}</span>
              </div>
              <p style="margin: 0.5rem 0;">${review.text}</p>
              <small style="color: var(--text-muted);">${new Date(review.date).toLocaleDateString()}</small>
            </div>
          `).join('')
        }
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

function handleLogin(event) {
  event.preventDefault();
  
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  
  // Get users from localStorage
  const users = JSON.parse(localStorage.getItem('watenUsers')) || [];
  const user = users.find(u => u.email === email && u.password === password);
  
  if (user) {
    currentUser = user;
    localStorage.setItem('watenCurrentUser', JSON.stringify(currentUser));
    updateAccountLink();
    showAccountDashboard();
    showNotification('Login successful!');
  } else {
    showNotification('Invalid email or password');
  }
}

function handleRegister(event) {
  event.preventDefault();
  
  const name = document.getElementById('registerName').value;
  const email = document.getElementById('registerEmail').value;
  const password = document.getElementById('registerPassword').value;
  const phone = document.getElementById('registerPhone').value;
  
  // Get users from localStorage
  const users = JSON.parse(localStorage.getItem('watenUsers')) || [];
  
  // Check if user already exists
  if (users.find(u => u.email === email)) {
    showNotification('An account with this email already exists');
    return;
  }
  
  // Create new user
  const newUser = {
    id: Date.now(),
    name: name,
    email: email,
    password: password, // In production, this should be hashed
    phone: phone,
    createdAt: new Date().toISOString()
  };
  
  users.push(newUser);
  localStorage.setItem('watenUsers', JSON.stringify(users));
  
  currentUser = newUser;
  localStorage.setItem('watenCurrentUser', JSON.stringify(currentUser));
  
  updateAccountLink();
  showAccountDashboard();
  showNotification('Account created successfully!');
}

function logout() {
  currentUser = null;
  localStorage.removeItem('watenCurrentUser');
  updateAccountLink();
  closeAccountModal();
  showNotification('Logged out successfully');
}

function updateAccountLink() {
  const accountLink = document.getElementById('account-link');
  if (currentUser) {
    accountLink.textContent = 'My Account';
  } else {
    accountLink.textContent = 'Account';
  }
}

function loadUserOrders() {
  const allOrders = JSON.parse(localStorage.getItem('watenOrders')) || [];
  const userOrders = allOrders
    .filter(order => (order?.customer?.email || '') === currentUser.email)
    .sort((a, b) => new Date(b.orderDate || 0) - new Date(a.orderDate || 0));
  
  const ordersContainer = document.getElementById('userOrders');
  
  if (userOrders.length === 0) {
    ordersContainer.innerHTML = '<p style="color: var(--text-muted);">You haven\'t placed any orders yet.</p>';
    return;
  }
  
  ordersContainer.innerHTML = userOrders.map(order => `
    <div style="background: var(--bg-dark); padding: 1rem; margin-bottom: 1rem; border-radius: 8px;">
      <p><strong>Order ID:</strong> ${order.orderId}</p>
      <p><strong>Product:</strong> ${order?.product?.name || 'N/A'}</p>
      <p><strong>Total:</strong> ${order.totalPrice || 0} TND</p>
      <p><strong>Status:</strong> <span style="color: var(--accent);">${order.status || 'pending'}</span></p>
      <p><strong>Date:</strong> ${new Date(order.orderDate).toLocaleDateString()}</p>
    </div>
  `).join('');
}

// Initialize systems on page load
document.addEventListener('DOMContentLoaded', function() {
  updateAccountLink();
});

// Mobile Menu Functions
function toggleMobileMenu() {
  const nav = document.getElementById('header-nav');
  const overlay = document.getElementById('mobile-menu-overlay');
  
  nav.classList.toggle('mobile-open');
  overlay.classList.toggle('active');
  
  // Prevent body scroll when menu is open
  if (nav.classList.contains('mobile-open')) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
}

function closeMobileMenu() {
  const nav = document.getElementById('header-nav');
  const overlay = document.getElementById('mobile-menu-overlay');
  
  nav.classList.remove('mobile-open');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

// Close mobile menu when clicking on nav links
document.querySelectorAll('#header-nav a').forEach(link => {
  link.addEventListener('click', function() {
    if (window.innerWidth <= 768) {
      closeMobileMenu();
    }
  });
});

// Handle window resize
window.addEventListener('resize', function() {
  if (window.innerWidth > 768) {
    closeMobileMenu();
  }
});

// Order Management System
async function submitOrder(event) {
  event.preventDefault();

  if (!currentProduct || !currentProduct.name) {
    showNotification('Please choose a product first');
    return;
  }

  const formData = new FormData(event.target);
  const quantity = Math.max(1, parseInt(formData.get('quantity'), 10) || 1);
  const unitPrice = Number(currentProduct.price) || 0;

  const orderData = {
    orderId: 'ORD-' + Date.now(),
    product: currentProduct,
    customer: {
      name: formData.get('customerName'),
      phone: formData.get('phoneNumber'),
      email: formData.get('email'),
      address: formData.get('address'),
      city: formData.get('city'),
      postalCode: formData.get('postalCode')
    },
    quantity,
    notes: formData.get('notes'),
    totalPrice: unitPrice * quantity,
    orderDate: new Date().toISOString(),
    status: 'pending'
  };

  let savedOrder = orderData;
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });

    if (!response.ok) {
      let message = `Failed to confirm order (${response.status})`;
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch (_) {}
      throw new Error(message);
    }

    const payload = await response.json().catch(() => null);
    if (payload?.order) savedOrder = payload.order;
  } catch (error) {
    console.warn('Server order sync failed, using local fallback:', error);
    showNotification('Order saved locally. Server sync failed.');
  }

  persistOrderLocally(savedOrder);
  sendOrderNotification(savedOrder);
  showOrderConfirmation(savedOrder);
  closeProduct();
}

function persistOrderLocally(orderData) {
  let orders = [];
  try {
    orders = JSON.parse(localStorage.getItem('watenOrders')) || [];
  } catch (_) {
    orders = [];
  }

  const index = orders.findIndex(order => String(order.orderId) === String(orderData.orderId));
  if (index >= 0) {
    orders[index] = orderData;
  } else {
    orders.push(orderData);
  }

  localStorage.setItem('watenOrders', JSON.stringify(orders));
}

function sendOrderNotification(orderData) {
  // Create notification data
  const notification = {
    type: 'new_order',
    orderId: orderData.orderId,
    customerName: orderData.customer.name,
    customerPhone: orderData.customer.phone,
    customerEmail: orderData.customer.email,
    product: orderData.product.name,
    quantity: orderData.quantity,
    totalPrice: orderData.totalPrice,
    address: orderData.customer.address + ', ' + orderData.customer.city,
    orderDate: orderData.orderDate,
    notes: orderData.notes,
    timestamp: new Date().toISOString()
  };
  
  // Save notification to localStorage (backup)
  const notifications = JSON.parse(localStorage.getItem('watenNotifications')) || [];
  notifications.push(notification);
  localStorage.setItem('watenNotifications', JSON.stringify(notifications));
  
  // Send email confirmation to customer
  sendCustomerEmail(orderData);
  
  // Send email notification to admin
  sendAdminEmail(orderData);
  
  // Show admin notification on page (for development)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    showAdminNotification(notification);
  }
}

function sendCustomerEmail(orderData) {
  const templateParams = {
    customer_name: orderData.customer.name,
    order_id: orderData.orderId,
    product_name: orderData.product.name,
    quantity: orderData.quantity,
    total_price: orderData.totalPrice,
    customer_email: orderData.customer.email,
    delivery_address: orderData.customer.address + ', ' + orderData.customer.city,
    phone: orderData.customer.phone,
    order_date: new Date().toLocaleDateString()
  };
  
  emailjs.send('YOUR_SERVICE_ID', 'customer_order_template', templateParams)
    .then(function(response) {
      console.log('Customer email sent successfully!', response.status, response.text);
    }, function(error) {
      console.log('Failed to send customer email:', error);
    });
}

function sendAdminEmail(orderData) {
  const templateParams = {
    order_id: orderData.orderId,
    customer_name: orderData.customer.name,
    customer_phone: orderData.customer.phone,
    customer_email: orderData.customer.email,
    product_name: orderData.product.name,
    quantity: orderData.quantity,
    total_price: orderData.totalPrice,
    delivery_address: orderData.customer.address + ', ' + orderData.customer.city,
    notes: orderData.notes || 'None',
    order_date: new Date().toLocaleDateString()
  };
  
  emailjs.send('YOUR_SERVICE_ID', 'admin_notification_template', templateParams)
    .then(function(response) {
      console.log('Admin email sent successfully!', response.status, response.text);
    }, function(error) {
      console.log('Failed to send admin email:', error);
    });
}

function sendToAdminDashboard(orderData) {
  // Send order to your external dashboard
  const webhookUrl = 'https://waten.onrender.com/admin.html';
  
  // Method 1: Webhook/POST request
  fetch(webhookUrl + '/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderData)
  }).catch(error => {
    console.log('Webhook failed, trying alternative method...');
    
    // Method 2: Email service (you can integrate with EmailJS, SendGrid, etc.)
    sendEmailNotification(orderData);
  });
}

function sendEmailNotification(orderData) {
  // You can integrate with email services like EmailJS
  console.log('EMAIL NOTIFICATION:', orderData);
  
  // Example with EmailJS (you need to set up EmailJS account)
  /*
  emailjs.send('your_service_id', 'your_template_id', {
    order_id: orderData.orderId,
    customer_name: orderData.customerName,
    customer_phone: orderData.customerPhone,
    customer_email: orderData.customerEmail,
    product: orderData.product,
    quantity: orderData.quantity,
    total_price: orderData.totalPrice,
    address: orderData.address,
    notes: orderData.notes
  }).then(function(response) {
    console.log('Email sent successfully!', response.status, response.text);
  }, function(error) {
    console.log('Failed to send email...', error);
  });
  */
}

function showOrderConfirmation(orderData) {
  const confirmationMessage = `
✅ ORDER CONFIRMED!

Order ID: ${orderData.orderId}
Product: ${orderData.product.name}
Quantity: ${orderData.quantity}
Total: ${orderData.totalPrice} TND

Customer: ${orderData.customer.name}
Phone: ${orderData.customer.phone}

We'll contact you within 24 hours to confirm delivery.
Thank you for choosing WATEN! 🎯
  `;
  
  alert(confirmationMessage);
}

function showAdminNotification(notification) {
  // Create admin notification banner
  const notificationBanner = document.createElement('div');
  notificationBanner.style.cssText = `
    position: fixed; top: 80px; right: 20px; background: #c9a227; color: #0a0a0a;
    padding: 15px 20px; border-radius: 8px; z-index: 10000; max-width: 350px;
    box-shadow: 0 4px 20px rgba(201, 162, 39, 0.4); font-weight: 600;
    animation: slideIn 0.3s ease;
  `;
  
  notificationBanner.innerHTML = `
    <div style="margin-bottom: 8px;">🎯 NEW ORDER!</div>
    <div style="font-size: 14px; font-weight: 400;">
      Order: ${notification.orderId}<br>
      Customer: ${notification.customerName}<br>
      Product: ${notification.product}<br>
      Total: ${notification.totalPrice} TND<br>
      Phone: ${notification.customerPhone}
    </div>
    <button onclick="this.parentElement.remove()" style="
      margin-top: 10px; background: #0a0a0a; color: #c9a227; border: none;
      padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;
    ">Close</button>
  `;
  
  document.body.appendChild(notificationBanner);
  
  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (notificationBanner.parentElement) {
      notificationBanner.remove();
    }
  }, 10000);
}

function viewOrders() {
  const orders = JSON.parse(localStorage.getItem('watenOrders')) || [];
  
  if (orders.length === 0) {
    alert('No orders yet.');
    return;
  }
  
  let orderList = '🎯 WATEN ORDERS\n\n';
  orders.forEach((order, index) => {
    orderList += `${index + 1}. Order ID: ${order.orderId}\n`;
    orderList += `   Customer: ${order.customer.name}\n`;
    orderList += `   Product: ${order.product.name}\n`;
    orderList += `   Quantity: ${order.quantity}\n`;
    orderList += `   Total: ${order.totalPrice} TND\n`;
    orderList += `   Date: ${new Date(order.orderDate).toLocaleDateString()}\n`;
    orderList += `   Status: ${order.status}\n\n`;
  });
  
  alert(orderList);
}

function viewNotifications() {
  const notifications = JSON.parse(localStorage.getItem('watenNotifications')) || [];
  
  if (notifications.length === 0) {
    alert('No notifications yet.');
    return;
  }
  
  let notificationList = '📧 ORDER NOTIFICATIONS\n\n';
  notifications.forEach((notif, index) => {
    notificationList += `${index + 1}. Order: ${notif.orderId}\n`;
    notificationList += `   Customer: ${notif.customerName}\n`;
    notificationList += `   Phone: ${notif.customerPhone}\n`;
    notificationList += `   Email: ${notif.customerEmail}\n`;
    notificationList += `   Product: ${notif.product}\n`;
    notificationList += `   Total: ${notif.totalPrice} TND\n`;
    notificationList += `   Address: ${notif.address}\n`;
    notificationList += `   Date: ${new Date(notif.timestamp).toLocaleString()}\n\n`;
  });
  
  alert(notificationList);
}

// Add admin buttons to header (only visible on localhost)
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  const header = document.querySelector('header');
  const adminDiv = document.createElement('div');
  adminDiv.style.cssText = 'position: fixed; top: 60px; right: 20px; z-index: 1000;';
  adminDiv.innerHTML = `
    <button onclick="viewOrders()" style="
      background: #c9a227; color: #0a0a0a; border: none; padding: 8px 12px;
      margin: 2px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;
    ">View Orders</button>
    <button onclick="viewNotifications()" style="
      background: #1a1a2e; color: #c9a227; border: none; padding: 8px 12px;
      margin: 2px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;
    ">View Notifications</button>
  `;
  document.body.appendChild(adminDiv);
}

// Manager Access Panel (hidden by default)
let managerPanelVisible = false;

function createManagerPanel() {
  const managerPanel = document.createElement('div');
  managerPanel.id = 'manager-panel';
  managerPanel.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 1000;
    background: #1a1a2e; border: 1px solid #c9a227; border-radius: 8px;
    padding: 10px; font-size: 12px; display: none;
  `;
  managerPanel.innerHTML = `
    <div style="color: #c9a227; font-weight: 600; margin-bottom: 8px;">🎯 MANAGER ACCESS</div>
    <button onclick="viewOrders()" style="
      background: #c9a227; color: #0a0a0a; border: none; padding: 5px 10px;
      margin: 2px; border-radius: 4px; cursor: pointer; width: 100%;
    ">View Orders</button>
    <button onclick="viewNotifications()" style="
      background: #0a0a0a; color: #c9a227; border: 1px solid #c9a227; padding: 5px 10px;
      margin: 2px; border-radius: 4px; cursor: pointer; width: 100%;
    ">View Notifications</button>
    <button onclick="exportOrders()" style="
      background: #0a0a0a; color: #fff; border: 1px solid #666; padding: 5px 10px;
      margin: 2px; border-radius: 4px; cursor: pointer; width: 100%;
    ">Export Orders</button>
    <button onclick="toggleManagerPanel()" style="
      background: #333; color: #999; border: 1px solid #666; padding: 3px 8px;
      margin: 2px; border-radius: 4px; cursor: pointer; width: 100%; font-size: 10px;
    ">Hide Panel</button>
  `;
  document.body.appendChild(managerPanel);
}

function toggleManagerPanel() {
  const panel = document.getElementById('manager-panel');
  if (panel) {
    managerPanelVisible = !managerPanelVisible;
    panel.style.display = managerPanelVisible ? 'block' : 'none';
  }
}

// Secret key combination: W + A + T + E + N (press in sequence)
let secretKeys = [];
const secretCode = ['w', 'a', 't', 'e', 'n'];

document.addEventListener('keydown', function(e) {
  const key = e.key.toLowerCase();
  
  // Add key to sequence
  secretKeys.push(key);
  
  // Keep only last 5 keys
  if (secretKeys.length > 5) {
    secretKeys.shift();
  }
  
  // Check if secret code matches
  if (secretKeys.join('') === secretCode.join('')) {
    toggleManagerPanel();
    secretKeys = []; // Reset sequence
    
    // Show subtle notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed; top: 100px; right: 20px; background: #c9a227; color: #0a0a0a;
      padding: 10px 15px; border-radius: 4px; z-index: 10000;
      font-size: 12px; font-weight: 600; opacity: 0; transition: opacity 0.3s;
    `;
    notification.textContent = '🎯 Manager Panel ' + (managerPanelVisible ? 'Opened' : 'Closed');
    document.body.appendChild(notification);
    
    setTimeout(() => notification.style.opacity = '1', 10);
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }
});

// Alternative: Triple click on logo (backup method)
let logoClickCount = 0;
let logoClickTimer;

document.addEventListener('DOMContentLoaded', function() {
  const logo = document.getElementById('header-logo');
  if (logo) {
    logo.addEventListener('click', function() {
      logoClickCount++;
      
      if (logoClickCount === 3) {
        toggleManagerPanel();
        logoClickCount = 0;
        clearTimeout(logoClickTimer);
      } else {
        clearTimeout(logoClickTimer);
        logoClickTimer = setTimeout(() => {
          logoClickCount = 0;
        }, 1000);
      }
    });
  }
});

function exportOrders() {
  const orders = JSON.parse(localStorage.getItem('watenOrders')) || [];
  const notifications = JSON.parse(localStorage.getItem('watenNotifications')) || [];
  
  const exportData = {
    orders: orders,
    notifications: notifications,
    exportDate: new Date().toISOString()
  };
  
  // Create downloadable file
  const dataStr = JSON.stringify(exportData, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
  
  const exportFileDefaultName = 'waten-orders-' + new Date().toISOString().split('T')[0] + '.json';
  
  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
}

// Create manager panel when page loads
window.addEventListener('load', createManagerPanel);

function applyServerSiteContent(site) {
  if (!site) return;
  if (site.meta) {
    if (site.meta.title) document.title = site.meta.title;
    var metaDesc = document.getElementById('meta-description');
    if (metaDesc && site.meta.description) metaDesc.setAttribute('content', site.meta.description);
  }
  if (site.header) {
    var logo = document.getElementById('header-logo');
    if (logo && site.header.logoText) logo.textContent = site.header.logoText;
    var nav = document.getElementById('header-nav');
    if (nav && site.header.navLinks && site.header.navLinks.length) {
      nav.innerHTML = site.header.navLinks.map(function(l) {
        return '<a href="' + (l.href || '#').replace(/"/g, '&quot;') + '">' + (l.label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</a>';
      }).join('');
    }
  }
  if (site.hero) {
    var heroTitle = document.getElementById('hero-title');
    if (heroTitle && site.hero.title) heroTitle.textContent = site.hero.title;
    var heroTag = document.getElementById('hero-tagline');
    if (heroTag && site.hero.tagline !== undefined) heroTag.textContent = site.hero.tagline;
    var heroCta = document.getElementById('hero-cta');
    if (heroCta && site.hero.ctaText) heroCta.textContent = site.hero.ctaText;
    var heroSec = document.getElementById('hero-section');
    if (heroSec && site.hero.backgroundImage) heroSec.style.backgroundImage = "url('" + site.hero.backgroundImage.replace(/'/g, "\\'") + "')";
  }
  if (site.collection) {
    var ch = document.getElementById('collection-heading');
    if (ch && site.collection.heading !== undefined) ch.textContent = site.collection.heading;
    var cs = document.getElementById('collection-subtitle');
    if (cs && site.collection.subtitle !== undefined) cs.textContent = site.collection.subtitle;
  }
  if (site.invest) {
    var ih = document.getElementById('invest-heading');
    if (ih && site.invest.heading !== undefined) ih.textContent = site.invest.heading;
    var ib = document.getElementById('invest-body');
    if (ib && site.invest.body !== undefined) ib.textContent = site.invest.body;
    var icta = document.getElementById('invest-cta');
    if (icta && site.invest.ctaText !== undefined) icta.textContent = site.invest.ctaText;
  }
  if (site.footer) {
    var fl = document.getElementById('footer-logo');
    if (fl && site.footer.logoText !== undefined) fl.textContent = site.footer.logoText;
    var ft = document.getElementById('footer-tagline');
    if (ft && site.footer.tagline !== undefined) ft.textContent = site.footer.tagline;
    var flinks = document.getElementById('footer-links');
    if (flinks && site.footer.links && site.footer.links.length) {
      flinks.innerHTML = site.footer.links.map(function(l) {
        return '<a href="' + (l.href || '#').replace(/"/g, '&quot;') + '">' + (l.label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</a>';
      }).join('');
    }
    var fc = document.getElementById('footer-copyright');
    if (fc && site.footer.copyright !== undefined) fc.textContent = site.footer.copyright;
  }
  if (site.social) {
    var wrap = document.getElementById('footer-social');
    var any = false;
    function setLink(id, url, text, isEmail) {
      var el = document.getElementById(id);
      if (!el) return;
      if (url && url.trim()) {
        any = true;
        var v = url.trim();
        if (isEmail && v.indexOf('@') !== -1 && !v.startsWith('mailto:')) {
          el.href = 'mailto:' + v;
        } else {
          el.href = v;
        }
        if (text) el.textContent = text;
        el.style.display = 'inline-block';
      } else {
        el.style.display = 'none';
      }
    }
    setLink('footer-whatsapp', site.social.whatsapp, 'WhatsApp', false);
    setLink('footer-instagram', site.social.instagram, 'Instagram', false);
    setLink('footer-tiktok', site.social.tiktok, 'TikTok', false);
    setLink('footer-email', site.social.email, 'Email', true);
    if (wrap) wrap.style.display = any ? 'flex' : 'none';
  }
}

// Load and apply content from dashboard
function loadSiteContent() {
  console.log('Loading site content from dashboard...');
  fetch('/api/site')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to load /api/site');
      return res.json();
    })
    .then((site) => {
      localStorage.setItem('watenSiteContent', JSON.stringify(site || {}));
      applyServerSiteContent(site || {});
    })
    .catch((error) => {
      console.warn('Site API unavailable, using local cache:', error);
      const storedContent = localStorage.getItem('watenSiteContent');
      if (!storedContent) return;
      try {
        applyServerSiteContent(JSON.parse(storedContent));
      } catch (parseError) {
        console.error('Error parsing cached site content:', parseError);
      }
    });
}

function applyLegacySiteContent(content) {
  console.log('Applying content to site:', content);
  
  // Update page title and meta
  if (content.metaTitle) {
    document.title = content.metaTitle;
    console.log('Updated title:', content.metaTitle);
  }
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && content.metaDescription) {
    metaDesc.content = content.metaDescription;
    console.log('Updated meta description:', content.metaDescription);
  }
  
  // Update header logo
  const logo = document.getElementById('header-logo');
  if (logo && content.logo) {
    logo.textContent = content.logo;
    console.log('Updated logo:', content.logo);
  }
  
  // Update navigation
  const nav = document.getElementById('header-nav');
  if (nav && content.nav) {
    nav.innerHTML = '';
    const navItems = content.nav.split('\n');
    navItems.forEach(item => {
      if (item.trim()) {
        const [text, href] = item.split('|');
        const link = document.createElement('a');
        link.href = href || '#';
        link.textContent = text.trim();
        nav.appendChild(link);
      }
    });
    console.log('Updated navigation:', navItems);
  }
  
  // Update hero section
  if (content.heroTitle) {
    const heroTitle = document.querySelector('.hero h1');
    if (heroTitle) {
      heroTitle.textContent = content.heroTitle;
      console.log('Updated hero title:', content.heroTitle);
    }
  }
  
  if (content.heroTagline) {
    const heroTagline = document.querySelector('.hero .tagline');
    if (heroTagline) {
      heroTagline.textContent = content.heroTagline;
      console.log('Updated hero tagline:', content.heroTagline);
    }
  }
  
  // Fix: Dashboard saves as heroCta, main site looks for heroButton
  if (content.heroCta || content.heroButton) {
    const heroButton = document.querySelector('.hero .btn');
    if (heroButton) {
      heroButton.textContent = content.heroCta || content.heroButton;
      console.log('Updated hero button:', content.heroCta || content.heroButton);
    }
  }
  
  // Update collection section
  if (content.collectionHeading) {
    const collectionHeading = document.querySelector('#collection h2');
    if (collectionHeading) {
      collectionHeading.textContent = content.collectionHeading;
      console.log('Updated collection heading:', content.collectionHeading);
    }
  }
  
  if (content.collectionSubtitle) {
    const collectionSubtitle = document.querySelector('#collection p');
    if (collectionSubtitle) {
      collectionSubtitle.textContent = content.collectionSubtitle;
      console.log('Updated collection subtitle:', content.collectionSubtitle);
    }
  }
  
  // Update invest section
  if (content.investHeading) {
    const investHeading = document.querySelector('#invest h2');
    if (investHeading) {
      investHeading.textContent = content.investHeading;
      console.log('Updated invest heading:', content.investHeading);
    }
  }
  
  if (content.investBody) {
    const investBody = document.querySelector('#invest p');
    if (investBody) {
      investBody.textContent = content.investBody;
      console.log('Updated invest body:', content.investBody);
    }
  }
  
  // Fix: Dashboard saves as investCta, main site looks for investButton
  if (content.investCta || content.investButton) {
    const investButton = document.querySelector('#invest .btn');
    if (investButton) {
      investButton.textContent = content.investCta || content.investButton;
      console.log('Updated invest button:', content.investCta || content.investButton);
    }
  }
  
  // Update footer
  if (content.footerLogo) {
    const footerLogo = document.querySelector('.footer-brand .logo');
    if (footerLogo) {
      footerLogo.textContent = content.footerLogo;
      console.log('Updated footer logo:', content.footerLogo);
    }
  }
  
  if (content.footerTagline) {
    const footerTagline = document.querySelector('.footer-brand p');
    if (footerTagline) {
      footerTagline.textContent = content.footerTagline;
      console.log('Updated footer tagline:', content.footerTagline);
    }
  }
  
  if (content.footerLinks) {
    const footerLinks = document.querySelector('.footer-links');
    if (footerLinks) {
      footerLinks.innerHTML = '';
      const linkItems = content.footerLinks.split('\n');
      linkItems.forEach(item => {
        if (item.trim()) {
          const [text, href] = item.split('|');
          const link = document.createElement('a');
          link.href = href || '#';
          link.textContent = text.trim();
          footerLinks.appendChild(link);
        }
      });
      console.log('Updated footer links:', linkItems);
    }
  }
  
  if (content.footerCopyright) {
    const footerCopyright = document.querySelector('.footer-bottom span');
    if (footerCopyright) {
      footerCopyright.textContent = content.footerCopyright;
      console.log('Updated footer copyright:', content.footerCopyright);
    }
  }
  
  console.log('Content application complete');
}

// Add dashboard button to main site
function addDashboardButton() {
  // Check if button already exists
  if (document.querySelector('.dashboard-btn')) return;
  
  const btn = document.createElement('button');
  btn.className = 'dashboard-btn';
  btn.innerHTML = '🎛 Dashboard';
  btn.onclick = function() {
    window.open('/dashboard.html', '_blank');
  };
  document.body.appendChild(btn);
}

// Listen for dashboard sync from official site
window.addEventListener('storage', function(e) {
  if (e.key === 'waten_products') {
    console.log('🔄 Dashboard sync received - updating products');
    try {
      const newProducts = JSON.parse(e.newValue);
      if (Array.isArray(newProducts)) {
        allProducts = newProducts;
        renderProducts(allProducts.length ? allProducts : FALLBACK_PRODUCTS);
        showNotification('Products updated from dashboard!');
      }
    } catch (error) {
      console.error('❌ Failed to sync from dashboard:', error);
    }
  }
});

// Listen for site content updates
window.addEventListener('storage', function(e) {
  if (e.key === 'watenSiteContent') {
    console.log('🔄 Site content updated - applying changes');
    try {
      const newContent = JSON.parse(e.newValue);
      applyServerSiteContent(newContent);
      showNotification('Site content updated from dashboard!');
    } catch (error) {
      console.error('❌ Failed to sync site content:', error);
    }
  }
});

// Broadcast channel for real-time updates
if (typeof BroadcastChannel !== 'undefined') {
  const channel = new BroadcastChannel('waten_dashboard');
  channel.onmessage = function(event) {
    if (event.data.type === 'products_updated') {
      console.log('🔄 Products updated via broadcast channel');
      allProducts = event.data.products;
      renderProducts(allProducts.length ? allProducts : FALLBACK_PRODUCTS);
      showNotification('Products updated in real-time!');
    }
    if (event.data.type === 'site_updated') {
      loadSiteContent();
      showNotification('Site content updated in real-time!');
    }
  };
}

// Add dashboard button when page loads
if (window.location.pathname.includes('idex.html')) {
  addDashboardButton();
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 WATEN Site Loaded');
  addDashboardButton();
});

// Load content on page load
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, loading content...');
  loadSiteContent();
});

function updateSiteElement(id, content) {
  const element = document.getElementById(id);
  if (element && content) element.textContent = content;
}

function scrollToSection(sectionId) {
  const element = document.getElementById(sectionId);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth' });
  }
}

// Notification System for Main Site
function showNotification(message) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; background: #c9a227; color: #0a0a0a;
    padding: 15px 20px; border-radius: 8px; z-index: 10000; max-width: 350px;
    box-shadow: 0 4px 20px rgba(201, 162, 39, 0.4); font-weight: 600;
    animation: slideIn 0.3s ease;
  `;
  
  notification.innerHTML = `
    <div style="margin-bottom: 8px;">✅ SUCCESS</div>
    <div style="font-size: 14px; font-weight: 400;">${message}</div>
  `;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 3000);
}

loadSiteContent();

const FALLBACK_PRODUCTS = [
  { id: 1, name: 'Black Essential Hoodie', price: 120, image: 'https://images.unsplash.com/photo-1602810319428-019690571b5b' },
  { id: 2, name: 'Oversized Street Tee', price: 80, image: 'https://images.unsplash.com/photo-1593032465171-8f8b8fdd6b47' },
  { id: 3, name: 'Limited Varsity Jacket', price: 250, image: 'images/iyadh.jpg' },
  { id: 4, name: 'Tataouine 3200 Hoodie', price: 140, image: '12.png' }
];
const FALLBACK_IMG = 'https://images.unsplash.com/photo-1556821840-3a63f95609a7';

// Search Functionality
let allProducts = [];

function handleSearch(event) {
  if (event.key === 'Enter') {
    performSearch();
  } else {
    // Live search as user types
    const query = event.target.value.toLowerCase();
    if (query.length > 0) {
      showSearchResults(query);
    } else {
      hideSearchResults();
    }
  }
}

function performSearch() {
  const query = document.getElementById('search-input').value.toLowerCase();
  if (query.length === 0) return;
  
  const filteredProducts = allProducts.filter(product => 
    product.name.toLowerCase().includes(query) ||
    product.price.toString().includes(query)
  );
  
  if (filteredProducts.length === 0) {
    showNotification('No products found matching your search');
    return;
  }
  
  // Update products display with search results
  renderProducts(filteredProducts);
  
  // Scroll to collection section
  document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
  
  // Update section header to show search results
  document.getElementById('collection-heading').textContent = `Search Results (${filteredProducts.length})`;
  
  hideSearchResults();
}

function showSearchResults(query) {
  const results = allProducts.filter(product => 
    product.name.toLowerCase().includes(query) ||
    product.price.toString().includes(query)
  );
  
  // Create or update search results dropdown
  let searchResults = document.getElementById('search-results');
  if (!searchResults) {
    searchResults = document.createElement('div');
    searchResults.id = 'search-results';
    searchResults.className = 'search-results';
    document.querySelector('.search-container').appendChild(searchResults);
  }
  
  if (results.length === 0) {
    searchResults.innerHTML = '<div style="padding: 1rem; color: var(--text-muted);">No products found</div>';
  } else {
    searchResults.innerHTML = results.map(product => `
      <div class="search-result-item" onclick="selectSearchResult(${product.id})">
        <img src="${product.image || FALLBACK_IMG}" alt="${product.name}" onerror="this.src='${FALLBACK_IMG}'">
        <div>
          <div style="font-weight: 600;">${product.name}</div>
          <div style="color: var(--accent);">${product.price} TND</div>
        </div>
      </div>
    `).join('');
  }
  
  searchResults.style.display = 'block';
}

function hideSearchResults() {
  const searchResults = document.getElementById('search-results');
  if (searchResults) {
    searchResults.style.display = 'none';
  }
}

function selectSearchResult(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (product) {
    openProduct(product.name, product.price);
    hideSearchResults();
    document.getElementById('search-input').value = '';
  }
}

// Close search results when clicking outside
document.addEventListener('click', function(event) {
  if (!event.target.closest('.search-container')) {
    hideSearchResults();
  }
});

// Load products - prioritize dashboard sync for real-time updates
function loadProducts() {
  console.log('🔄 loadProducts called - loading from dashboard sync...');
  
  // Try to load from localStorage first (dashboard sync)
  try {
    const storedProducts = localStorage.getItem('waten_products');
    if (storedProducts) {
      const products = JSON.parse(storedProducts);
      allProducts = products;
      renderProducts(products);
      console.log('✅ Products loaded from dashboard sync:', allProducts.length, 'items');
      return;
    }
  } catch (error) {
    console.warn('⚠️ Dashboard sync failed, trying API:', error);
  }
  
  // Try API for visitor sync
  fetch('/api/products')
    .then(res => res.json())
    .then(products => {
      allProducts = products;
      // Save to localStorage for dashboard sync
      localStorage.setItem('waten_products', JSON.stringify(allProducts));
      renderProducts(allProducts.length ? allProducts : FALLBACK_PRODUCTS);
      console.log('✅ Products loaded from API:', allProducts.length, 'items');
    })
    .catch(error => {
      console.error('❌ API failed, using localStorage fallback:', error);
      // Fallback to localStorage
      try {
        const storedProducts = localStorage.getItem('waten_products');
        if (storedProducts) {
          const products = JSON.parse(storedProducts);
          allProducts = products;
          renderProducts(products);
        } else {
          allProducts = FALLBACK_PRODUCTS;
          renderProducts(FALLBACK_PRODUCTS);
        }
      } catch (fallbackError) {
        console.error('❌ Fallback failed:', fallbackError);
        allProducts = FALLBACK_PRODUCTS;
        renderProducts(FALLBACK_PRODUCTS);
      }
    });
}

// Initialize products on load
loadProducts();

function renderProducts(products) {
  const container = document.getElementById('productsContainer');
  if (!products || products.length === 0) {
    container.innerHTML = '<div class="empty-products" style="text-align:center;padding:3rem;color:rgba(255,255,255,0.5);">No items found.</div>';
    return;
  }
  container.innerHTML = products.map(p => {
    const name = (p.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const img = (p.image || FALLBACK_IMG).replace(/"/g, '&quot;');
    const data = JSON.stringify(p).replace(/"/g, '&quot;');
    const isWished = wishlist.some(item => item.id === p.id);
    const heartColor = isWished ? 'var(--accent)' : 'rgba(255,255,255,0.3)';
    
    return `<div class="product" data-product="${data}">
      <div class="product-image">
        <img src="${img}" alt="${name}" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'">
        <button onclick="addToWishlistFromEl(this.parentElement.parentElement)" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.5); border: none; font-size: 1.2rem; cursor: pointer; color: ${heartColor}; border-radius: 50%; width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; z-index: 5;">❤</button>
      </div>
      <div class="product-details">
        <div class="name">${name}</div>
        <div class="price">${p.price} TND</div>
        <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
          <button class="btn" style="flex: 1; padding: 0.5rem; font-size: 0.7rem;" onclick="openProductFromEl(this.parentElement.parentElement.parentElement)">Order Now</button>
          <button class="btn" style="flex: 1; padding: 0.5rem; font-size: 0.7rem; background: transparent; border: 1px solid var(--accent); color: var(--accent);" onclick="showProductReviews(${p.id || 'null'})">⭐ Reviews</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function addToWishlistFromEl(el) {
  const p = JSON.parse(el.dataset.product);
  addToWishlist({
    id: p.id || Date.now(),
    name: p.name,
    price: p.price,
    image: p.image || FALLBACK_IMG
  });
}

// Wishlist System
let wishlist = JSON.parse(localStorage.getItem('watenWishlist')) || [];

function updateWishlistCounter() {
  const countEl = document.getElementById('wishlistCount');
  if (countEl) countEl.innerText = wishlist.length;
}

function addToWishlist(product) {
  const existingIndex = wishlist.findIndex(item => item.id === product.id);
  
  if (existingIndex > -1) {
    // Already in wishlist, so toggle it off
    wishlist.splice(existingIndex, 1);
    localStorage.setItem('watenWishlist', JSON.stringify(wishlist));
    showNotification('Product removed from wishlist');
    updateWishlistCounter();
    renderProducts(allProducts); // update hearts
    return;
  }
  
  wishlist.push(product);
  localStorage.setItem('watenWishlist', JSON.stringify(wishlist));
  showNotification('Product added to wishlist!');
  updateWishlistCounter();
  renderProducts(allProducts); // update hearts
}

function removeFromWishlist(productId) {
  wishlist = wishlist.filter(item => item.id !== productId);
  localStorage.setItem('watenWishlist', JSON.stringify(wishlist));
  updateWishlistCounter();
  renderWishlistItems();
  renderProducts(allProducts); // update hearts
}

function toggleWishlistModal() {
  const wModal = document.getElementById('wishlistModal');
  if (!wModal) return;
  
  if (wModal.style.display === 'flex') {
    wModal.style.display = 'none';
  } else {
    renderWishlistItems();
    wModal.style.display = 'flex';
  }
}

function renderWishlistItems() {
  const container = document.getElementById('wishlistContainer');
  if (!container) return;
  
  if (wishlist.length === 0) {
    container.innerHTML = '<p style="text-align:center; color: var(--text-muted);">Your wishlist is empty.</p>';
    return;
  }
  
  container.innerHTML = wishlist.map(item => `
    <div style="display: flex; gap: 1rem; align-items: center; padding: 1rem; border: 1px solid var(--border); border-radius: 8px;">
      <img src="${item.image}" alt="${item.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;">
      <div style="flex: 1;">
        <div style="font-weight: 600;">${item.name}</div>
        <div style="color: var(--accent);">${item.price} TND</div>
      </div>
      <button onclick="removeFromWishlist(${item.id})" style="background: transparent; border: 1px solid red; color: red; padding: 0.3rem 0.6rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">Remove</button>
    </div>
  `).join('');
}

// Size guide modal triggers
function openSizeGuide() {
  const sgModal = document.getElementById('sizeGuideModal');
  if (sgModal) sgModal.style.display = 'flex';
}

function closeSizeGuide() {
  const sgModal = document.getElementById('sizeGuideModal');
  if (sgModal) sgModal.style.display = 'none';
}

// Ensure wishlist counter is correct on load
document.addEventListener('DOMContentLoaded', updateWishlistCounter);

// Product Reviews System
function addProductReview(productId, review) {
  const reviews = JSON.parse(localStorage.getItem('watenReviews')) || {};
  
  if (!reviews[productId]) {
    reviews[productId] = [];
  }
  
  reviews[productId].push({
    ...review,
    date: new Date().toISOString(),
    userName: currentUser ? currentUser.name : 'Anonymous'
  });
  
  localStorage.setItem('watenReviews', JSON.stringify(reviews));
  showNotification('Review added successfully!');
}

function getProductReviews(productId) {
  const reviews = JSON.parse(localStorage.getItem('watenReviews')) || {};
  return reviews[productId] || [];
}

function showProductReviews(productId) {
  const reviews = getProductReviews(productId);
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content">
      <span class="close" onclick="this.closest('.modal').remove()">Close</span>
      <h3>Customer Reviews (${reviews.length})</h3>
      
      ${currentUser ? `
        <div style="margin: 2rem 0; padding: 1rem; background: var(--bg-dark); border-radius: 8px;">
          <h4>Write a Review</h4>
          <form onsubmit="submitReview(event, ${productId})">
            <div class="form-group">
              <label>Rating</label>
              <select id="reviewRating" required>
                <option value="5">⭐⭐⭐⭐⭐ Excellent</option>
                <option value="4">⭐⭐⭐⭐ Very Good</option>
                <option value="3">⭐⭐⭐ Good</option>
                <option value="2">⭐⭐ Fair</option>
                <option value="1">⭐ Poor</option>
              </select>
            </div>
            <div class="form-group">
              <label>Your Review</label>
              <textarea id="reviewText" rows="3" required placeholder="Share your experience with this product..."></textarea>
            </div>
            <button type="submit" class="btn confirm-order-btn">Submit Review</button>
          </form>
        </div>
      ` : '<p style="color: var(--text-muted);">Please login to write a review</p>'}
      
      <div style="margin-top: 2rem;">
        ${reviews.length === 0 ? 
          '<p style="color: var(--text-muted);">No reviews yet. Be the first to review!</p>' :
          reviews.map(review => `
            <div style="padding: 1rem; border-bottom: 1px solid var(--border); margin-bottom: 1rem;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <strong>${review.userName}</strong>
                <span>${'⭐'.repeat(review.rating)}</span>
              </div>
              <p style="margin: 0.5rem 0;">${review.text}</p>
              <small style="color: var(--text-muted);">${new Date(review.date).toLocaleDateString()}</small>
            </div>
          `).join('')
        }
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

function submitReview(event, productId) {
  event.preventDefault();
  
  const rating = parseInt(document.getElementById('reviewRating').value);
  const text = document.getElementById('reviewText').value;
  
  addProductReview(productId, { rating, text });
  event.target.reset();
  
  // Refresh reviews display
  setTimeout(() => {
    const modal = document.querySelector('.modal');
    if (modal) modal.remove();
    showProductReviews(productId);
  }, 1000);
}

function openProductFromEl(el) {
  const p = JSON.parse(el.dataset.product);
  openProduct(p.name, p.price);
}

// Load products - prioritize API for visitor sync
function loadProducts() {
  console.log('🔄 loadProducts called - loading from API first...');
  
  // Try API first for visitor sync
  fetch('/api/products')
    .then(res => res.json())
    .then(products => {
      allProducts = products;
      // Save to localStorage for dashboard sync
      localStorage.setItem('waten_products', JSON.stringify(allProducts));
      renderProducts(allProducts.length ? allProducts : FALLBACK_PRODUCTS);
      console.log('✅ Products loaded from API:', allProducts.length, 'items');
    })
    .catch(error => {
      console.error('❌ API failed, using localStorage:', error);
      // Fallback to localStorage
      try {
        const storedProducts = localStorage.getItem('waten_products');
        if (storedProducts) {
          const products = JSON.parse(storedProducts);
          allProducts = products;
          renderProducts(products);
        } else {
          allProducts = FALLBACK_PRODUCTS;
          renderProducts(FALLBACK_PRODUCTS);
        }
      } catch (fallbackError) {
        console.error('❌ Fallback failed:', fallbackError);
        allProducts = FALLBACK_PRODUCTS;
        renderProducts(FALLBACK_PRODUCTS);
      }
    });
}

// Initialize products on load
loadProducts();

function scrollToCollection() {
  document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
}

function openProduct(name, price) {
  currentProduct = { name, price };
  document.getElementById('productName').innerText = name;
  document.getElementById('productPrice').innerText = price + ' TND';
  document.getElementById('unitPrice').innerText = price + ' TND';
  document.getElementById('totalPrice').innerText = price + ' TND';
  document.getElementById('productModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  
  // Reset form
  document.getElementById('orderForm').reset();
  document.getElementById('summaryQuantity').innerText = '1';
}

function closeProduct() {
  document.getElementById('productModal').style.display = 'none';
  document.body.style.overflow = '';
}

// Update order summary when quantity changes
document.addEventListener('DOMContentLoaded', function() {
  const quantitySelect = document.getElementById('quantity');
  if (quantitySelect) {
    quantitySelect.addEventListener('change', updateOrderSummary);
  }
});

function updateOrderSummary() {
  const quantity = parseInt(document.getElementById('quantity').value);
  const unitPrice = currentProduct.price || 0;
  const totalPrice = unitPrice * quantity;
  
  document.getElementById('summaryQuantity').innerText = quantity;
  document.getElementById('totalPrice').innerText = totalPrice + ' TND';
}

// Close modal on backdrop click
document.getElementById('productModal').addEventListener('click', function(e) {
  if (e.target === this) closeProduct();
});

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeProduct();
});

const sections = document.querySelectorAll('section');
window.addEventListener('scroll', function() {
  sections.forEach(function(sec) {
    const top = sec.getBoundingClientRect().top;
    if (top < window.innerHeight - 100) sec.classList.add('show');
  });
});

// Premium 3D Background for WATEN - Luxury Fashion Edition
let scene, camera, renderer;
let floatingElements = [];
let particleSystem;
let mouseX = 0, mouseY = 0;
let time = 0;

function init3DBackground() {
  console.log('Initializing premium 3D background...');
  
  const container = document.getElementById('canvas-container');
  if (!container) {
    console.error('Canvas container not found!');
    return;
  }

  // Premium scene setup
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0a0a, 5, 50);
  
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 15;

  // Enhanced renderer
  renderer = new THREE.WebGLRenderer({ 
    alpha: true, 
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0a0a0a, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Create premium elements
  createPremiumFloatingElements();
  createLuxuryParticles();
  createCinematicLighting();
  
  // Start animation
  animate();
  
  // Handle events
  window.addEventListener('resize', onWindowResize, false);
  window.addEventListener('mousemove', onMouseMove, false);
  window.addEventListener('click', onMouseClick, false);
  
  console.log('Premium 3D background initialized!');
}

function createPremiumFloatingElements() {
  const elements = [
    { text: 'WATEN', size: 3, color: 0xc9a227, glowColor: 0xffd700, position: [0, 3, -5], type: 'logo' },
    { text: 'SUPREME', size: 2, color: 0xffffff, glowColor: 0xc9a227, position: [-4, 2, -8], type: 'badge' },
    { text: 'LUXURY', size: 1.8, color: 0xffd700, glowColor: 0xff6b35, position: [4, 1, -10], type: 'premium' },
    { text: 'STREETWEAR', size: 1.5, color: 0xffffff, glowColor: 0xc9a227, position: [-3, -2, -12], type: 'fashion' },
    { text: 'EXCLUSIVE', size: 1.6, color: 0xc9a227, glowColor: 0xffd700, position: [3, -3, -14], type: 'exclusive' },
    { text: '♦', size: 2.5, color: 0xffffff, glowColor: 0xc9a227, position: [-5, 4, -16], type: 'diamond' },
    { text: '👔', size: 2, color: 0xffd700, glowColor: 0xff6b35, position: [5, 3, -18], type: 'fashion' },
    { text: '✨', size: 1.8, color: 0xffffff, glowColor: 0xffd700, position: [0, -4, -20], type: 'sparkle' }
  ];

  elements.forEach((element, index) => {
    // Create high-quality text canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 256;
    
    // Add glow effect
    context.shadowColor = `#${element.glowColor.toString(16).padStart(6, '0')}`;
    context.shadowBlur = 20;
    
    context.font = `bold ${element.size * 30}px 'Cormorant Garamond', serif`;
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(element.text, 256, 128);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: element.color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(element.size * 1.5, element.size * 0.75, 1);
    sprite.position.set(...element.position);
    
    floatingElements.push({
      sprite: sprite,
      basePosition: element.position,
      floatSpeed: 0.3 + Math.random() * 0.4,
      rotationSpeed: Math.random() * 0.01,
      type: element.type,
      glowIntensity: element.glowColor,
      magneticAttraction: element.type === 'logo' ? 0.8 : 0.3
    });
    
    scene.add(sprite);
  });
}

function createLuxuryParticles() {
  const particleCount = 200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 30;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
    
    // Gold and white particles
    const colorChoice = Math.random();
    if (colorChoice < 0.6) {
      colors[i * 3] = 0.79;     // R (c9a227)
      colors[i * 3 + 1] = 0.63; // G
      colors[i * 3 + 2] = 0.15; // B
    } else {
      colors[i * 3] = 1;     // R (white)
      colors[i * 3 + 1] = 1; // G
      colors[i * 3 + 2] = 1; // B
    }
    
    sizes[i] = Math.random() * 3 + 1;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 0.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });

  particleSystem = new THREE.Points(geometry, material);
  scene.add(particleSystem);
}

function createCinematicLighting() {
  // Ambient lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
  scene.add(ambientLight);
  
  // Main fashion spotlight
  const spotLight = new THREE.SpotLight(0xc9a227, 2, 50, Math.PI/6, 0.5);
  spotLight.position.set(0, 10, 10);
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 2048;
  spotLight.shadow.mapSize.height = 2048;
  scene.add(spotLight);
  
  // Accent lights
  const pointLight1 = new THREE.PointLight(0x1a1a2e, 1.5, 30);
  pointLight1.position.set(-20, 5, 0);
  scene.add(pointLight1);
  
  const pointLight2 = new THREE.PointLight(0xc9a227, 1, 40);
  pointLight2.position.set(20, 8, 0);
  scene.add(pointLight2);
  
  const pointLight3 = new THREE.PointLight(0xffd700, 0.8, 25);
  pointLight3.position.set(0, -10, 5);
  scene.add(pointLight3);
}

function onMouseMove(event) {
  mouseX = (event.clientX / window.innerWidth) * 2 - 1;
  mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onMouseClick(event) {
  // Create explosion effect
  const explosionLight = new THREE.PointLight(0xffffff, 3, 20);
  explosionLight.position.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    (event.clientY / window.innerHeight) * 2 - 1,
    5
  );
  scene.add(explosionLight);
  
  setTimeout(() => {
    scene.remove(explosionLight);
  }, 1000);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  
  time = Date.now() * 0.001;
  
  // Animate premium floating elements
  floatingElements.forEach((element, index) => {
    // Complex floating patterns
    const floatY = Math.sin(time * element.floatSpeed + index * 0.5) * 1.5;
    const floatX = Math.cos(time * element.floatSpeed * 0.7 + index * 0.3) * 1;
    const rotateZ = Math.sin(time * 0.2 + index * 0.1) * 0.05;
    
    element.sprite.position.y = element.basePosition[1] + floatY;
    element.sprite.position.x = element.basePosition[0] + floatX;
    element.sprite.rotation.z += rotateZ;
    
    // Fade in effect
    if (element.sprite.material.opacity < 0.9) {
      element.sprite.material.opacity += 0.01;
    }
    
    // Mouse attraction for all elements
    const attractionStrength = element.magneticAttraction || 0.3;
    const attractionX = mouseX * attractionStrength;
    const attractionY = mouseY * attractionStrength * 0.6;
    
    element.sprite.position.x += (attractionX - element.sprite.position.x * 0.1) * 0.05;
    element.sprite.position.y += (attractionY - element.sprite.position.y * 0.1) * 0.05;
    
    // Pulsing effect for premium elements
    if (element.type === 'premium' || element.type === 'exclusive') {
      const pulse = 1 + Math.sin(time * 2 + index) * 0.2;
      element.sprite.scale.set(
        element.sprite.scale.x * pulse,
        element.sprite.scale.y * pulse,
        1
      );
    }
  });
  
  // Animate particles
  if (particleSystem) {
    particleSystem.rotation.y = time * 0.05;
    particleSystem.rotation.x = time * 0.02;
    
    // Make particles respond to mouse
    particleSystem.position.x = mouseX * 2;
    particleSystem.position.y = mouseY * 2;
    
    const positions = particleSystem.geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] += Math.sin(time + i * 0.01) * 0.01;
    }
    particleSystem.geometry.attributes.position.needsUpdate = true;
  }
  
  // Premium camera movement
  camera.position.x = Math.sin(time * 0.1) * 2;
  camera.position.y = Math.cos(time * 0.08) * 1.5;
  camera.lookAt(0, 0, 0);
  
  renderer.render(scene, camera);
}

// Initialize as fast as possible
function startPremium3D() {
  if (window._waten_3d_started) return;
  if (typeof THREE !== 'undefined') {
    window._waten_3d_started = true;
    console.log('Starting premium 3D instantly...');
    init3DBackground();
  } else {
    console.error('Three.js not strictly loaded yet!');
  }
}

if (document.readyState !== 'loading') {
  startPremium3D();
} else {
  document.addEventListener('DOMContentLoaded', startPremium3D);
}
// Fallback
window.addEventListener('load', startPremium3D);

// Fashion Template Mouse Interactions
const cursor = document.querySelector('.cursor');
const cursorFollower = document.querySelector('.cursor-follower');

let currentX = 0, currentY = 0;

// Mouse movement tracking
document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  
  // Update cursor position
  cursor.style.left = mouseX + 'px';
  cursor.style.top = mouseY + 'px';
  
  // Update cursor follower with lag
  setTimeout(() => {
    cursorFollower.style.left = mouseX + 'px';
    cursorFollower.style.top = mouseY + 'px';
  }, 100);
});

// Smooth cursor animation
function animateCursor() {
  currentX += (mouseX - currentX) * 0.1;
  currentY += (mouseY - currentY) * 0.1;
  
  requestAnimationFrame(animateCursor);
}
animateCursor();

// Hover effects for interactive elements
document.querySelectorAll('a, button, .product').forEach(element => {
  element.addEventListener('mouseenter', () => {
    cursor.style.transform = 'translate(-50%, -50%) scale(1.5)';
    cursorFollower.style.transform = 'translate(-50%, -50%) scale(1.2)';
  });
  
  element.addEventListener('mouseleave', () => {
    cursor.style.transform = 'translate(-50%, -50%) scale(1)';
    cursorFollower.style.transform = 'translate(-50%, -50%) scale(1)';
  });
});

// Hide default cursor on mobile
if (window.innerWidth > 768) {
  document.body.style.cursor = 'none';
} else {
  cursor.style.display = 'none';
  cursorFollower.style.display = 'none';
}


