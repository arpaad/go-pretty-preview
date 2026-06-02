package main

func A() (int, error) {
	return 42, nil
}

func B() (int, error) {
	a, err := A()
	if err != nil {
		return 0, err
	}
	return a + 1, nil
}

func main() {
	a, err := B()
	if err != nil {
		return
	}
	println(a)
}
