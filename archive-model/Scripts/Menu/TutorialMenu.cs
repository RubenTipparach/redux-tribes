using System.Collections;
using System.Collections.Generic;
using DevLocker.Utils;
using TMPro;
using UnityEngine;
using UnityEngine.SceneManagement;

public class TutorialMenu : MonoBehaviour
{
    public int tutorialIndex = 0;
    public bool inTutorialMode = true;

    public GameObject[] tutorials;
    public GameObject mainMenu;

    public GameObject TutorialPanel;
    public GameObject WinPanel;
    public GameObject LoosePanel;

    public SceneReference menuReference;
    public SceneReference campaignReference;
    public SceneReference tutorialMenu;
    public SceneReference scenarioMenu;


    public bool loadScenarioMenu;
    public bool loadTutorialMenu;
    public bool loadCampaignMenu;

    public GameObject backToCampaignMap;
    //public bool isTutorial = false;

    public bool loadNextMiniCampaignMenu;

    public TextMeshProUGUI winningRewards;

    public void SetCreditsAward(int moneyWon, int total){
        winningRewards.text = @$"Credits Awarded: {moneyWon}
Total Credits: {total}";
    }

    public void StartTutorial(){

    }

    public void StartGame()
    {
        gameObject.SetActive(false);
        inTutorialMode = false;
        tutorialIndex = 0;
        mainMenu.SetActive(true);
        ClearTutorails();

        if (GameManager.Instance.musicManager.musicPlayer.clip == null)
        {
            GameManager.Instance.musicManager.PlayMusic();
        }
        else
        {
            GameManager.Instance.musicManager.Resume();
        }


        //TutorialPanel.SetActive(true);
        //WinPanel.SetActive(false);
        //LoosePanel.SetActive(false);
    }

    public void ExitGame(bool failed)
    {

        //Application.Quit();
        if (loadTutorialMenu) // comment this out if you want tutorial menu scene
        {
            SceneManager.LoadScene(menuReference.ScenePath);
            return;
        }

        if (loadTutorialMenu)
        {
            SceneManager.LoadScene(tutorialMenu.ScenePath);
        }
        else if (loadCampaignMenu && failed)
        {
            SceneManager.LoadScene(menuReference.ScenePath);
        }
        else if (loadCampaignMenu)
        {
            SceneManager.LoadScene(campaignReference.ScenePath);
        }
        else if (loadScenarioMenu)
        {
            SceneManager.LoadScene(scenarioMenu.ScenePath);
        }
        else
        {
            SceneManager.LoadScene(menuReference.ScenePath);
        }
    }



    public void ClearTutorails(){
        foreach(var t in tutorials)
        {
            t.SetActive(false);
        }
    }

    public void RestartGame(){
        SceneManager.LoadScene(GameManager.Instance.nextLevelIndex - 1);//load current level lol
    }

    public void NextTutorial(){
        ClearTutorails();
        if(tutorialIndex >= tutorials.Length)
        {
            tutorialIndex = 0;
            mainMenu.SetActive(true);
        }else{
            mainMenu.SetActive(false);

            tutorials[tutorialIndex].SetActive(true);
            tutorialIndex++;
        }
    }

    public void BringUpTutorialMenu()
    {
        GameManager.Instance.musicManager.Pause();
        gameObject.SetActive(true);
        mainMenu.SetActive(true);
        inTutorialMode = true;
        tutorialIndex = 0;
        ClearTutorails();
    }

    public void Win(){
        gameObject.SetActive(true);
        TutorialPanel.SetActive(false);
        WinPanel.SetActive(true);
    }

    public void Loose(){
        gameObject.SetActive(true);
        TutorialPanel.SetActive(false);
        LoosePanel.SetActive(true);
    }

    // Start is called before the first frame update
    void Start()
    {
        TutorialPanel.SetActive(true);
        WinPanel.SetActive(false);
        LoosePanel.SetActive(false);

        if (loadTutorialMenu) // comment this out if you want tutorial menu scene
        {
            // Debug.Log("wtf man");
            backToCampaignMap.gameObject.SetActive(false);
        }

        // Debug.Log("loading menu");

    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
