using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class TutorialUI : MonoBehaviour
{
    public List<GameObject> tutorialPanels;

    public TextMeshProUGUI tutorialPanelText;

    public int index = 0;

    public GameObject current;

    public int limitPanels = -1;
    // Start is called before the first frame update
    void Start()
    {
        CompileTutorialPanels(limitPanels);
    }

    public void CompileTutorialPanels(int limitPanels)
    {
        // bool first = true;
        int i = 0;
        tutorialPanels = new List<GameObject>();

        foreach (Transform t in transform)
        {
            tutorialPanels.Add(t.gameObject);
            if (i == index)
            {
                t.gameObject.SetActive(true);
                current = t.gameObject;
            }
            else
            {
                t.gameObject.SetActive(false);
            }
            //first = false;

            if (limitPanels != -1 && (i+2) > limitPanels)
            {
                break;
            }

            i++;
        }

        tutorialPanelText.text = $"1/{tutorialPanels.Count}";

        if (index > tutorialPanels.Count)
        {
            index = tutorialPanels.Count - 1;
        }
    }

    public void Next()
    {
        if (index < tutorialPanels.Count - 1)
        {
            index++;
            SetNewPanel();
        }
    }

    public void Previous()
    {

        if (index > 0)
        {
            index--;
            SetNewPanel();
        }
    }

    private void SetNewPanel()
    {

        current.SetActive(false);
        current = tutorialPanels[index];
        current.SetActive(true);
        tutorialPanelText.text = $"{index + 1}/{tutorialPanels.Count}";
    }

    // Update is called once per frame
    void Update()
    {

    }

    public void LoadInMoreTutorials(int numberToLoadTotal)
    {
        index = limitPanels;

        limitPanels = numberToLoadTotal;
        CompileTutorialPanels(numberToLoadTotal);

        SetNewPanel();
    }
}
