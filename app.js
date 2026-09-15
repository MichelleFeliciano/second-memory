// Second Memory — Books collection
// All persistence is local (localStorage). No network calls, no dependencies.

const STORAGE_KEY = 'secondMemory.books.v1';
const STATUSES = ['want_to_buy', 'owned_unread', 'owned_read'];

function loadBooks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveBooks(books) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
}

function makeId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let books = loadBooks();

function addBook(title, author, status) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return;
  books.push({
    id: makeId(),
    title: trimmedTitle,
    author: author.trim(),
    status: STATUSES.includes(status) ? status : 'want_to_buy',
    rating: null,
    dateAdded: new Date().toISOString(),
  });
  saveBooks(books);
  render();
}

function updateStatus(id, newStatus) {
  const book = books.find((b) => b.id === id);
  if (!book || !STATUSES.includes(newStatus)) return;
  book.status = newStatus;
  if (newStatus !== 'owned_read') book.rating = null;
  saveBooks(books);
  render();
}

function updateRating(id, rating) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  book.rating = rating ? Number(rating) : null;
  saveBooks(books);
}

function deleteBook(id) {
  books = books.filter((b) => b.id !== id);
  saveBooks(books);
  render();
}

function matchesSearch(book, term) {
  if (!term) return true;
  const haystack = `${book.title} ${book.author}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function render() {
  const searchTerm = document.getElementById('search-input').value;
  const visible = books.filter((b) => matchesSearch(b, searchTerm));
  const template = document.getElementById('book-card-template');

  STATUSES.forEach((status) => {
    const list = document.querySelector(`[data-list="${status}"]`);
    list.innerHTML = '';
    const itemsForStatus = visible.filter((b) => b.status === status);
    document.querySelector(`[data-count="${status}"]`).textContent = itemsForStatus.length;

    itemsForStatus.forEach((book) => {
      const node = template.content.cloneNode(true);
      node.querySelector('.book-title').textContent = book.title;
      node.querySelector('.book-author').textContent = book.author || '';

      const ratingLabel = node.querySelector('.rating-label');
      const ratingSelect = node.querySelector('.rating-select');
      const ratingDisplay = node.querySelector('.book-rating');

      if (status === 'owned_read') {
        ratingLabel.hidden = false;
        ratingSelect.value = book.rating ? String(book.rating) : '';
        ratingDisplay.textContent = book.rating ? '★'.repeat(book.rating) : '';
        ratingSelect.addEventListener('change', (e) => {
          updateRating(book.id, e.target.value);
          ratingDisplay.textContent = e.target.value ? '★'.repeat(Number(e.target.value)) : '';
        });
      }

      const moveSelect = node.querySelector('.move-select');
      moveSelect.value = book.status;
      moveSelect.addEventListener('change', (e) => updateStatus(book.id, e.target.value));

      node.querySelector('.delete-btn').addEventListener('click', () => deleteBook(book.id));

      list.appendChild(node);
    });
  });

  document.getElementById('empty-state').hidden = books.length !== 0;
}

document.getElementById('add-book-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = document.getElementById('title-input');
  const authorInput = document.getElementById('author-input');
  const statusInput = document.getElementById('status-input');
  addBook(titleInput.value, authorInput.value, statusInput.value);
  titleInput.value = '';
  authorInput.value = '';
  titleInput.focus();
});

document.getElementById('search-input').addEventListener('input', render);

render();
