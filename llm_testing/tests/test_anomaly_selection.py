import unittest
from anomaly_model_selection import select_cases

class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.cases = ([{"case_id": f"A{i:03d}"} for i in range(20)] +
                      [{"case_id": f"N{i:03d}"} for i in range(20)])

    def test_deterministic(self):
        self.assertEqual(select_cases(self.cases, 12, 42),
                         select_cases(list(reversed(self.cases)), 12, 42))

    def test_balanced(self):
        selected = select_cases(self.cases, 12, 42)
        self.assertEqual(sum(x["case_id"].startswith("A") for x in selected), 6)
        self.assertEqual(sum(x["case_id"].startswith("N") for x in selected), 6)

    def test_full(self):
        self.assertEqual(len(select_cases(self.cases, 0, 42)), 40)

if __name__ == "__main__":
    unittest.main()
